import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { showToast } from '@/components/Toast';
import { RegisterColors as C } from '@/constants/Colors';

export default function RegisterScreen() {
  const { user, refreshProfile, signOut } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState(1); // 1: Choose mode, 2: Create, 3: Join
  const [loading, setLoading] = useState(false);

  // Form fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [orgCode, setOrgCode] = useState('');

  const handleCreateWorkspace = async () => {
    if (!firstName || !lastName || !companyName) {
      showToast('Please fill all fields', 'error');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('create_workspace', {
        p_company_name: companyName,
        p_first_name: firstName,
        p_last_name: lastName,
        p_user_id: user?.id,
      });

      if (error) throw error;

      showToast('Workspace created! Welcome.', 'success');
      await refreshProfile();
      router.replace('/(tabs)' as any);
    } catch (err: any) {
      showToast(err.message || 'Failed to create workspace', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinWorkspace = async () => {
    if (!firstName || !lastName || !orgCode) {
      showToast('Please fill all fields', 'error');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('employee_join_workspace', {
        p_org_code: orgCode,
        p_first_name: firstName,
        p_last_name: lastName,
        p_user_id: user?.id,
      });

      if (error) throw error;

      showToast('Joined workspace successfully!', 'success');
      await refreshProfile();
      router.replace('/(tabs)' as any);
    } catch (err: any) {
      showToast(err.message || 'Invalid organization code', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (step === 1) {
    return (
      <View style={s.container}>
        <View style={s.header}>
          <Text style={s.title}>Almost there!</Text>
          <Text style={s.subtitle}>Your account is verified. Now, let's set up your profile.</Text>
        </View>

        <View style={s.options}>
          <TouchableOpacity style={s.optionCard} onPress={() => setStep(2)}>
            <View style={[s.optionIcon, { backgroundColor: C.primary + '15' }]}>
              <Ionicons name="business-outline" size={28} color={C.primary} />
            </View>
            <View style={s.optionContent}>
              <Text style={s.optionTitle}>I am a Founder / HR</Text>
              <Text style={s.optionDesc}>Create a new company workspace and invite your team.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={C.muted} />
          </TouchableOpacity>

          <TouchableOpacity style={s.optionCard} onPress={() => setStep(3)}>
            <View style={[s.optionIcon, { backgroundColor: C.success + '15' }]}>
              <Ionicons name="people-outline" size={28} color={C.success} />
            </View>
            <View style={s.optionContent}>
              <Text style={s.optionTitle}>I am an Employee</Text>
              <Text style={s.optionDesc}>Join an existing workspace using a company code.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={C.muted} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={s.signOutBtn} onPress={signOut}>
          <Text style={s.signOutText}>Not your account? Sign Out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={s.backBtn} onPress={() => setStep(1)}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>

        <View style={s.formCard}>
          <Text style={s.formTitle}>{step === 2 ? 'Create Workspace' : 'Join Workspace'}</Text>
          <Text style={s.formSubtitle}>
            {step === 2 ? 'Set up your company and start managing payroll.' : 'Enter your details and company code to join.'}
          </Text>

          <View style={s.inputGroup}>
            <Text style={s.label}>First Name</Text>
            <TextInput
              style={s.input}
              placeholder="John"
              value={firstName}
              onChangeText={setFirstName}
            />
          </View>

          <View style={s.inputGroup}>
            <Text style={s.label}>Last Name</Text>
            <TextInput
              style={s.input}
              placeholder="Doe"
              value={lastName}
              onChangeText={setLastName}
            />
          </View>

          {step === 2 ? (
            <View style={s.inputGroup}>
              <Text style={s.label}>Company Name</Text>
              <TextInput
                style={s.input}
                placeholder="Acme Corp"
                value={companyName}
                onChangeText={setCompanyName}
              />
            </View>
          ) : (
            <View style={s.inputGroup}>
              <Text style={s.label}>Organization Code</Text>
              <TextInput
                style={[s.input, { fontWeight: '700', letterSpacing: 2 }]}
                placeholder="ABC123"
                autoCapitalize="characters"
                value={orgCode}
                onChangeText={setOrgCode}
              />
              <Text style={s.hint}>Ask your manager for the 6-digit code.</Text>
            </View>
          )}

          <TouchableOpacity
            style={[s.btn, loading && s.btnDisabled]}
            onPress={step === 2 ? handleCreateWorkspace : handleJoinWorkspace}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.btnText}>{step === 2 ? 'Create Workspace' : 'Join Workspace'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, padding: 24, justifyContent: 'center' },
  scroll: { flexGrow: 1, justifyContent: 'center' },
  header: { marginBottom: 32 },
  title: { fontSize: 28, fontWeight: '800', color: C.text },
  subtitle: { fontSize: 15, color: C.muted, marginTop: 8 },
  options: { gap: 16 },
  optionCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, padding: 20, borderRadius: 20,
    gap: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  optionIcon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  optionContent: { flex: 1 },
  optionTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  optionDesc: { fontSize: 12, color: C.muted, marginTop: 4 },
  signOutBtn: { marginTop: 40, alignSelf: 'center' },
  signOutText: { color: C.danger, fontWeight: '600', fontSize: 14 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 24 },
  backText: { fontSize: 16, fontWeight: '600', color: C.text },
  formCard: {
    backgroundColor: C.surface, padding: 24, borderRadius: 24,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16, elevation: 4,
  },
  formTitle: { fontSize: 22, fontWeight: '800', color: C.text },
  formSubtitle: { fontSize: 14, color: C.muted, marginTop: 4, marginBottom: 24 },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 6 },
  input: {
    backgroundColor: '#F8FAFC', borderWidth: 1.5, borderColor: C.border,
    borderRadius: 12, padding: 14, fontSize: 15, color: C.text,
  },
  hint: { fontSize: 11, color: C.muted, marginTop: 5 },
  btn: {
    backgroundColor: C.primary, padding: 16, borderRadius: 14,
    alignItems: 'center', marginTop: 8,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
