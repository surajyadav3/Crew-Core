import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { clearMustChangePassword, recordCurrentPassword } from '@/services/otpService';
import { validatePassword } from '@/lib/helpers';
import { showToast } from '@/components/Toast';
import { Colors as C } from '@/constants/Colors';

/**
 * Full-screen, non-dismissible gate shown right after login when the
 * employee is still on a temporary password (profile.must_change_password).
 * Mirrors the web app's DashboardLayout ForcePasswordChange exactly: same
 * validation rules, same two RPCs, same "temp password stays stale" note.
 */
export default function ForcePasswordChange() {
  const { profile, refreshProfile } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (!profile?.must_change_password) return null;

  const handleSubmit = async () => {
    setError('');
    const pwError = validatePassword(password);
    if (pwError) { setError(pwError); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }

    setSaving(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) throw authError;

      const { error: dbError } = await clearMustChangePassword();
      if (dbError) throw new Error('Could not save password change: ' + dbError.message);

      // Best-effort — shouldn't block the employee's own password change if it fails.
      recordCurrentPassword(password).catch(() => {});

      showToast('Password updated!', 'success');
      setPassword(''); setConfirm('');
      await refreshProfile();
    } catch (err: any) {
      setError(err.message || 'Could not update password. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.card}>
          <View style={s.iconWrap}>
            <Ionicons name="lock-closed" size={26} color={C.warning} />
          </View>
          <Text style={s.title}>Set Your Password</Text>
          <Text style={s.subtitle}>You're using a temporary password. Please create a new one before continuing.</Text>

          {!!error && (
            <View style={s.errorBanner}>
              <Ionicons name="alert-circle" size={15} color={C.danger} />
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}

          <View style={s.group}>
            <Text style={s.label}>New Password</Text>
            <View style={s.inputWrap}>
              <TextInput
                style={s.input} value={password} onChangeText={setPassword}
                secureTextEntry={!showPw} placeholder="••••••••" placeholderTextColor={C.muted}
                autoCapitalize="none" autoComplete="new-password"
              />
              <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPw((v) => !v)}>
                <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={17} color={C.muted} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.group}>
            <Text style={s.label}>Confirm Password</Text>
            <TextInput
              style={[s.input, s.inputStandalone]} value={confirm} onChangeText={setConfirm}
              secureTextEntry={!showPw} placeholder="••••••••" placeholderTextColor={C.muted}
              autoCapitalize="none" autoComplete="new-password"
            />
          </View>

          <Text style={s.hint}>At least 8 characters, with an uppercase letter, a lowercase letter, and a number.</Text>

          <TouchableOpacity style={[s.btn, saving && s.btnDisabled]} onPress={handleSubmit} disabled={saving} activeOpacity={0.85}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnText}>Save Password</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 420, backgroundColor: C.surface, borderRadius: 24, padding: 28, alignItems: 'center' },
  iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.warningBg, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { fontSize: 19, fontWeight: '800', color: C.text },
  subtitle: { fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 6, marginBottom: 18, lineHeight: 19 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.dangerBg, borderRadius: 12, padding: 11, marginBottom: 14, width: '100%' },
  errorText: { flex: 1, fontSize: 12.5, color: C.danger },
  group: { width: '100%', marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 7 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: C.border, borderRadius: 14, backgroundColor: '#FAFAFA' },
  input: { flex: 1, paddingVertical: 13, paddingHorizontal: 14, fontSize: 14, color: C.text },
  inputStandalone: { borderWidth: 1.5, borderColor: C.border, borderRadius: 14, backgroundColor: '#FAFAFA' },
  eyeBtn: { padding: 12 },
  hint: { fontSize: 11, color: C.muted, marginBottom: 18, alignSelf: 'flex-start' },
  btn: { width: '100%', backgroundColor: C.primary, borderRadius: 16, paddingVertical: 15, alignItems: 'center', shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
