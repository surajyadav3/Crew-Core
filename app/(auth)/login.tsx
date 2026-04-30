import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { detectIdentifierType } from '@/services/otpService';

const C = {
  primary: '#00AEEF',
  bg: '#F0F9FF',
  surface: '#FFFFFF',
  text: '#1E293B',
  muted: '#94A3B8',
  border: '#E2E8F0',
  success: '#22C55E',
  danger: '#EF4444',
};

function OtpBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const digits = value.padEnd(6, ' ').split('').slice(0, 6);
  return (
    <View style={s.otpRow}>
      {digits.map((d, i) => (
        <View key={i} style={[s.otpBox, d.trim() ? s.otpBoxFilled : null]}>
          <Text style={s.otpDigit}>{d.trim()}</Text>
        </View>
      ))}
      <TextInput
        style={s.otpHidden}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
      />
    </View>
  );
}

export default function LoginScreen() {
  const { signIn, sendOtp, verifyOtp, user, profile, loading } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<'password' | 'otp'>('password');

  // Password fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  // OTP fields
  const [identifier, setIdentifier] = useState('');
  const [idType, setIdType] = useState<'email' | 'phone' | null>(null);
  const [otpStep, setOtpStep] = useState(1);
  const [otp, setOtp] = useState('');
  const [resolvedId, setResolvedId] = useState('');

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user && profile) {
      router.replace('/' as any);
    }
  }, [user, profile, loading]);

  // Password login
  const handlePasswordLogin = useCallback(async () => {
    setError('');
    if (!email || !password) { setError('Please enter both email and password.'); return; }
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch (err: any) {
      console.log('[LOGIN ERROR]', JSON.stringify(err, null, 2));
      console.log('[LOGIN ERROR] message:', err.message);
      console.log('[LOGIN ERROR] status:', err.status);
      console.log('[LOGIN ERROR] code:', err.code);
      setError(err.message || 'Invalid email or password.');
    } finally {
      setSubmitting(false);
    }
  }, [email, password, signIn]);

  // OTP send
  const handleSendOtp = useCallback(async () => {
    setError(''); setSuccessMsg('');
    if (!identifier.trim()) { setError('Please enter your email or mobile number.'); return; }
    if (!idType) { setError('Please enter a valid email or mobile number.'); return; }
    setSubmitting(true);
    try {
      const result = await sendOtp(identifier);
      setResolvedId(result.identifier);
      setOtp('');
      setOtpStep(2);
      setSuccessMsg(`OTP sent to ${result.identifier}. Check your inbox.`);
    } catch (err: any) {
      if (err.message?.includes('not found')) setError('No account found. Please contact your admin.');
      else if (err.message?.includes('rate')) setError('Too many attempts. Please wait and try again.');
      else setError(err.message || 'Failed to send OTP. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [identifier, idType, sendOtp]);

  // OTP verify
  const handleVerifyOtp = useCallback(async () => {
    setError('');
    if (otp.length !== 6) { setError('Please enter the complete 6-digit OTP.'); return; }
    setSubmitting(true);
    try {
      await verifyOtp(resolvedId, otp, false);
    } catch (err: any) {
      if (err.message?.includes('expired')) setError('OTP expired. Please request a new one.');
      else if (err.message?.includes('invalid')) setError('Incorrect OTP. Please try again.');
      else setError(err.message || 'Verification failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [otp, resolvedId, verifyOtp]);

  useEffect(() => {
    if (otpStep === 2 && otp.length === 6 && !submitting) handleVerifyOtp();
  }, [otp]);

  if (loading) {
    return (
      <View style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={[s.muted, { marginTop: 12 }]}>Loading workspace…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {/* Logo */}
        <View style={s.logoWrap}>
          <View style={s.logoIcon}>
            <Text style={s.logoLetter}>C</Text>
          </View>
          <Text style={s.logoName}>CrewCore</Text>
          <Text style={s.tagline}>Smart Payroll for Modern Teams</Text>
        </View>

        <View style={s.card}>
          <Text style={s.title}>Welcome back</Text>
          <Text style={s.subtitle}>Sign in to your company workspace</Text>

          {/* Mode toggle */}
          <View style={s.toggleRow}>
            {(['password', 'otp'] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[s.toggleBtn, mode === m && s.toggleActive]}
                onPress={() => { setMode(m); setError(''); setSuccessMsg(''); setOtpStep(1); setOtp(''); }}
              >
                <Ionicons
                  name={m === 'password' ? 'lock-closed-outline' : 'phone-portrait-outline'}
                  size={14}
                  color={mode === m ? C.text : C.muted}
                />
                <Text style={[s.toggleText, mode === m && s.toggleTextActive]}>
                  {m === 'password' ? 'Password' : 'OTP Login'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Error / success banners */}
          {!!error && (
            <View style={s.banner}>
              <Ionicons name="alert-circle-outline" size={15} color={C.danger} />
              <Text style={s.bannerText}>{error}</Text>
            </View>
          )}
          {!!successMsg && (
            <View style={[s.banner, s.bannerSuccess]}>
              <Ionicons name="checkmark-circle-outline" size={15} color={C.success} />
              <Text style={[s.bannerText, { color: C.success }]}>{successMsg}</Text>
            </View>
          )}

          {/* ── Password form ── */}
          {mode === 'password' && (
            <>
              <View style={s.group}>
                <Text style={s.label}>Email Address</Text>
                <View style={s.inputWrap}>
                  <Ionicons name="mail-outline" size={16} color={C.muted} style={s.inputIcon} />
                  <TextInput
                    style={s.input}
                    placeholder="you@company.com"
                    placeholderTextColor={C.muted}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                  />
                </View>
              </View>

              <View style={s.group}>
                <Text style={s.label}>Password</Text>
                <View style={s.inputWrap}>
                  <Ionicons name="lock-closed-outline" size={16} color={C.muted} style={s.inputIcon} />
                  <TextInput
                    style={[s.input, { paddingRight: 44 }]}
                    placeholder="••••••••"
                    placeholderTextColor={C.muted}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPass}
                    autoComplete="password"
                  />
                  <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPass((v) => !v)}>
                    <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.muted} />
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity style={s.btn} onPress={handlePasswordLogin} disabled={submitting}>
                {submitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Ionicons name="log-in-outline" size={18} color="#fff" /><Text style={s.btnText}> Sign In</Text></>}
              </TouchableOpacity>
            </>
          )}

          {/* ── OTP form ── */}
          {mode === 'otp' && otpStep === 1 && (
            <>
              <View style={s.group}>
                <Text style={s.label}>Email Address</Text>
                <View style={s.inputWrap}>
                  <Ionicons name="mail-outline" size={16} color={C.muted} style={s.inputIcon} />
                  <TextInput
                    style={s.input}
                    placeholder="you@company.com"
                    placeholderTextColor={C.muted}
                    value={identifier}
                    onChangeText={(t) => { setIdentifier(t); setIdType(detectIdentifierType(t)); }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  {idType && (
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{idType.toUpperCase()}</Text>
                    </View>
                  )}
                </View>
                <Text style={s.hint}>We'll send a 6-digit OTP to your email.</Text>
              </View>

              <TouchableOpacity style={[s.btn, !idType && s.btnDisabled]} onPress={handleSendOtp} disabled={submitting || !idType}>
                {submitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Ionicons name="paper-plane-outline" size={18} color="#fff" /><Text style={s.btnText}> Send OTP</Text></>}
              </TouchableOpacity>
            </>
          )}

          {mode === 'otp' && otpStep === 2 && (
            <>
              <Text style={[s.muted, { textAlign: 'center', marginBottom: 16 }]}>
                Enter the 6-digit OTP sent to{'\n'}<Text style={{ color: C.text, fontWeight: '600' }}>{resolvedId}</Text>
              </Text>

              <OtpBoxes value={otp} onChange={setOtp} />

              <TouchableOpacity style={s.btn} onPress={handleVerifyOtp} disabled={submitting || otp.length !== 6}>
                {submitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Ionicons name="checkmark-circle-outline" size={18} color="#fff" /><Text style={s.btnText}> Verify OTP</Text></>}
              </TouchableOpacity>

              <View style={s.otpFooter}>
                <TouchableOpacity onPress={handleSendOtp} disabled={submitting}>
                  <Text style={[s.link, submitting && { opacity: 0.5 }]}>Resend OTP</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setOtpStep(1); setOtp(''); setError(''); setSuccessMsg(''); }}>
                  <Text style={s.link}>← Back</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* Trust badges */}
          <View style={s.trustRow}>
            {[
              { icon: 'shield-checkmark-outline' as const, label: 'Secure & Encrypted' },
              { icon: 'business-outline' as const, label: 'Multi-tenant' },
              { icon: 'lock-closed-outline' as const, label: 'RLS Protected' },
            ].map((t) => (
              <View key={t.label} style={s.trustItem}>
                <Ionicons name={t.icon} size={12} color={C.muted} />
                <Text style={s.trustText}>{t.label}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logoWrap: { alignItems: 'center', marginBottom: 28 },
  logoIcon: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
    shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  logoLetter: { color: '#fff', fontSize: 26, fontWeight: '800' },
  logoName: { fontSize: 24, fontWeight: '800', color: C.text, letterSpacing: -0.5 },
  tagline: { fontSize: 13, color: C.muted, marginTop: 4 },
  card: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  title: { fontSize: 20, fontWeight: '700', color: C.text, textAlign: 'center' },
  subtitle: { fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 4, marginBottom: 20 },
  toggleRow: {
    flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 12,
    padding: 4, gap: 4, marginBottom: 20,
  },
  toggleBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: 9,
  },
  toggleActive: { backgroundColor: C.surface, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  toggleText: { fontSize: 13, fontWeight: '600', color: C.muted },
  toggleTextActive: { color: C.text },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginBottom: 16,
  },
  bannerSuccess: { backgroundColor: '#F0FDF4' },
  bannerText: { flex: 1, fontSize: 13, color: C.danger },
  group: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: C.border, borderRadius: 12,
    backgroundColor: '#F8FAFC', overflow: 'hidden',
  },
  inputIcon: { paddingLeft: 12, paddingRight: 8 },
  input: { flex: 1, paddingVertical: 13, paddingRight: 12, fontSize: 14, color: C.text },
  eyeBtn: { padding: 12 },
  badge: {
    backgroundColor: '#E0F7FF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginRight: 8,
  },
  badgeText: { fontSize: 10, fontWeight: '700', color: C.primary },
  hint: { fontSize: 11, color: C.muted, marginTop: 5 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14,
    gap: 6, marginTop: 4,
    shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  otpRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: 20 },
  otpBox: {
    width: 44, height: 52, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.border,
    backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center',
  },
  otpBoxFilled: { borderColor: C.primary, backgroundColor: '#E0F7FF' },
  otpDigit: { fontSize: 22, fontWeight: '700', color: C.text },
  otpHidden: { position: 'absolute', opacity: 0, width: 1, height: 1 },
  otpFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  link: { fontSize: 13, color: C.primary, fontWeight: '600' },
  muted: { fontSize: 13, color: C.muted },
  trustRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 20, flexWrap: 'wrap' },
  trustItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trustText: { fontSize: 11, color: C.muted },
});
