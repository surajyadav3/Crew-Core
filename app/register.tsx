import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { showToast } from '@/components/Toast';
import OtpBoxes from '@/components/OtpBoxes';
import { detectIdentifierType } from '@/services/otpService';
import { lookupOrgCode, employeeJoinWorkspace } from '@/services/tenantService';
import { useDebounce } from '@/hooks/useDebounce';
import { validatePassword } from '@/lib/helpers';
import { RegisterColors as C } from '@/constants/Colors';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Resend countdown ─────────────────────────────────────────────────────────
function ResendTimer({ onResend, loading, cooldown = 60 }: { onResend: () => void; loading: boolean; cooldown?: number }) {
  const [sec, setSec] = useState(cooldown);
  useEffect(() => {
    if (sec <= 0) return;
    const t = setTimeout(() => setSec((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [sec]);
  const handle = () => { onResend(); setSec(cooldown); };
  if (sec > 0) {
    return <Text style={s.resendText}>Resend OTP in {String(Math.floor(sec / 60)).padStart(2, '0')}:{String(sec % 60).padStart(2, '0')}</Text>;
  }
  return (
    <TouchableOpacity onPress={handle} disabled={loading}>
      <Text style={[s.resendLink, loading && { opacity: 0.5 }]}>{loading ? 'Sending…' : "Didn't receive it? Resend OTP"}</Text>
    </TouchableOpacity>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────
function StepIndicator({ current }: { current: number }) {
  const steps = ['Details', 'Verify OTP'];
  return (
    <View style={s.stepRow}>
      {steps.map((label, i) => {
        const num = i + 1;
        const done = num < current;
        const active = num === current;
        return (
          <React.Fragment key={label}>
            <View style={s.stepItem}>
              <View style={[s.stepDot, (done || active) && s.stepDotActive]}>
                {done ? <Ionicons name="checkmark" size={12} color="#fff" /> : <Text style={[s.stepNum, (done || active) && s.stepNumActive]}>{num}</Text>}
              </View>
              <Text style={[s.stepLabel, active && s.stepLabelActive]}>{label}</Text>
            </View>
            {i < steps.length - 1 && <View style={[s.stepLine, done && s.stepLineActive]} />}
          </React.Fragment>
        );
      })}
    </View>
  );
}

type SignupMode = 'admin' | 'employee';
type SuccessData = { mode: SignupMode; companyName: string; joinCode?: string };

// ── Full account-creation flow: form → OTP → workspace RPC ───────────────────
function SignupFlow({ onDone, onSigningUpChange }: { onDone: () => void; onSigningUpChange?: (v: boolean) => void }) {
  const { sendOtp, verifyOtp } = useAuth();
  const [mode, setMode] = useState<SignupMode>('admin');
  const [step, setStep] = useState(1);
  const [successData, setSuccessData] = useState<SuccessData | null>(null);

  const [form, setForm] = useState({
    firstName: '', lastName: '', companyName: '', orgCode: '',
    email: '', phone: '', password: '', confirmPassword: '',
  });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const [companyPreview, setCompanyPreview] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const debouncedCode = useDebounce(form.orgCode, 500);

  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (mode !== 'employee' || debouncedCode.trim().length < 4) { setCompanyPreview(''); return; }
    let cancelled = false;
    setLookingUp(true);
    lookupOrgCode(debouncedCode).then(({ companyName }) => {
      if (!cancelled) { setCompanyPreview(companyName || ''); setLookingUp(false); }
    });
    return () => { cancelled = true; };
  }, [debouncedCode, mode]);

  const handleContinue = async () => {
    setError('');
    const { firstName, lastName, companyName, orgCode, email, phone, password, confirmPassword } = form;

    if (mode === 'admin') {
      if (!firstName || !lastName || !companyName || !email || !password) { setError('Please fill in all required fields.'); return; }
    } else {
      if (!orgCode || !firstName || !lastName || !email || !password) { setError('Please fill in all required fields.'); return; }
      if (!companyPreview) { setError('Invalid organization code. Please check with your Admin.'); return; }
    }
    if (!EMAIL_RE.test(email)) { setError('Please enter a valid email address.'); return; }
    if (phone && detectIdentifierType(phone.trim()) !== 'phone') { setError('Please enter a valid 10-digit mobile number.'); return; }
    const pwError = validatePassword(password);
    if (pwError) { setError(pwError); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }

    setSending(true);
    try {
      const identifier = email.trim().toLowerCase();
      await sendOtp(identifier, true);
      setOtp('');
      setSuccessMsg(`OTP sent to ${identifier}. Check your inbox.`);
      setStep(2);
    } catch (err: any) {
      setError(err.message || 'Failed to send OTP. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleResend = async () => {
    setSending(true);
    setError('');
    try {
      await sendOtp(form.email.trim().toLowerCase(), true);
      setSuccessMsg('OTP resent successfully.');
    } catch (err: any) {
      setError(err.message || 'Failed to resend OTP.');
    } finally {
      setSending(false);
    }
  };

  const handleVerifyAndCreate = useCallback(async () => {
    if (otp.length !== 6) { setError('Please enter the complete 6-digit OTP.'); return; }
    setError('');
    setVerifying(true);
    // verifyOtp below establishes a real session (user becomes truthy) before the
    // workspace/profile row exists — RegisterScreen's `user && !profile` check would
    // otherwise swap this flow out for WorkspaceStep the instant AuthContext's profile
    // fetch resolves null, unmounting this component mid-signup and losing the
    // "Workspace Created!" join-code screen below. Held true until this component
    // hands off via onDone, so RegisterScreen defers to us for the whole flow.
    onSigningUpChange?.(true);
    try {
      const identifier = form.email.trim().toLowerCase();
      const authData = await verifyOtp(identifier, otp, true, form.password, form.firstName, form.lastName);
      const user = authData?.user;
      if (!user) throw new Error('Could not establish user session. Please try again.');

      if (mode === 'admin') {
        const { data: joinCode, error: rpcError } = await supabase.rpc('create_workspace', {
          p_company_name: form.companyName,
          p_first_name: form.firstName,
          p_last_name: form.lastName,
          p_user_id: user.id,
        });
        if (rpcError) {
          const msg = rpcError.message || '';
          if (msg.includes('already exists') || msg.includes('already registered')) {
            throw new Error('An account with this email already exists. Please sign in instead.');
          }
          throw new Error('Workspace setup failed: ' + msg);
        }
        setSuccessData({ mode: 'admin', companyName: form.companyName, joinCode });
      } else {
        await employeeJoinWorkspace(form.orgCode, form.firstName, form.lastName, user.id);
        setSuccessData({ mode: 'employee', companyName: companyPreview });
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please try again.');
    } finally {
      setVerifying(false);
    }
  }, [otp, form, mode, verifyOtp, companyPreview]);

  useEffect(() => {
    if (step === 2 && otp.length === 6 && !verifying) handleVerifyAndCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  if (successData) {
    return (
      <View style={s.container}>
        <View style={s.successWrap}>
          <View style={s.successIconWrap}>
            <Ionicons name={successData.mode === 'admin' ? 'business' : 'checkmark-circle'} size={44} color={C.success} />
          </View>
          <Text style={s.successTitle}>{successData.mode === 'admin' ? 'Workspace Created!' : "You're In!"}</Text>
          <Text style={s.successSubtitle}>
            {successData.mode === 'admin'
              ? `Your company ${successData.companyName} is all set up.`
              : `You've joined ${successData.companyName} successfully.`}
          </Text>
          {successData.mode === 'admin' && successData.joinCode && (
            <View style={s.joinCodeBox}>
              <Text style={s.joinCodeLabel}>Share this Organization Code with your employees:</Text>
              <Text style={s.joinCodeText} selectable>{successData.joinCode}</Text>
              <Text style={s.joinCodeHint}>Ask your admin to find this again anytime in Settings.</Text>
            </View>
          )}
          <TouchableOpacity style={s.btn} onPress={onDone}>
            <Text style={s.btnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.header}>
          <Text style={s.title}>{mode === 'admin' ? 'Register Your Business' : 'Join Your Company'}</Text>
          <Text style={s.subtitle}>{mode === 'admin' ? 'Set up your company workspace in seconds' : "Enter the org code your Admin shared"}</Text>
        </View>

        {step === 1 && (
          <View style={s.modeToggle}>
            {([
              { key: 'admin' as const, icon: 'business-outline' as const, label: 'Create My Company' },
              { key: 'employee' as const, icon: 'people-outline' as const, label: 'Join My Company' },
            ]).map((m) => (
              <TouchableOpacity
                key={m.key}
                style={[s.modeBtn, mode === m.key && s.modeBtnActive]}
                onPress={() => { setMode(m.key); setError(''); }}
                activeOpacity={0.8}
              >
                <Ionicons name={m.icon} size={14} color={mode === m.key ? '#fff' : C.muted} />
                <Text style={[s.modeBtnText, mode === m.key && s.modeBtnTextActive]}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={s.formCard}>
          <StepIndicator current={step} />

          {!!error && (
            <View style={s.banner}>
              <Ionicons name="alert-circle" size={16} color={C.danger} />
              <Text style={s.bannerText}>{error}</Text>
            </View>
          )}
          {!!successMsg && step === 2 && (
            <View style={[s.banner, s.bannerSuccess]}>
              <Ionicons name="checkmark-circle" size={16} color={C.success} />
              <Text style={[s.bannerText, { color: C.success }]}>{successMsg}</Text>
            </View>
          )}

          {step === 1 ? (
            <>
              {mode === 'employee' && (
                <View style={s.inputGroup}>
                  <Text style={s.label}>Organization Code *</Text>
                  <View style={s.orgCodeWrap}>
                    <TextInput
                      style={[s.input, s.orgCodeInput]}
                      placeholder="e.g. ABC123"
                      autoCapitalize="characters"
                      maxLength={8}
                      value={form.orgCode}
                      onChangeText={(v) => set('orgCode')(v.toUpperCase())}
                    />
                    {lookingUp && <ActivityIndicator size="small" color={C.primary} style={s.orgCodeSpinner} />}
                  </View>
                  {companyPreview ? (
                    <Text style={s.orgCodeFound}>✓ Joining: {companyPreview}</Text>
                  ) : form.orgCode.length >= 4 && !lookingUp ? (
                    <Text style={s.orgCodeNotFound}>✕ Code not found. Check with your Admin.</Text>
                  ) : (
                    <Text style={s.hint}>Ask your Admin for the organization code.</Text>
                  )}
                </View>
              )}

              <View style={s.row}>
                <View style={[s.inputGroup, { flex: 1 }]}>
                  <Text style={s.label}>First Name *</Text>
                  <TextInput style={s.input} placeholder="John" value={form.firstName} onChangeText={set('firstName')} />
                </View>
                <View style={[s.inputGroup, { flex: 1 }]}>
                  <Text style={s.label}>Last Name *</Text>
                  <TextInput style={s.input} placeholder="Doe" value={form.lastName} onChangeText={set('lastName')} />
                </View>
              </View>

              {mode === 'admin' && (
                <View style={s.inputGroup}>
                  <Text style={s.label}>Company Name *</Text>
                  <TextInput style={s.input} placeholder="e.g. Acme Pvt Ltd" value={form.companyName} onChangeText={set('companyName')} />
                </View>
              )}

              <View style={s.inputGroup}>
                <Text style={s.label}>Work Email *</Text>
                <TextInput style={s.input} placeholder="you@company.com" keyboardType="email-address" autoCapitalize="none" value={form.email} onChangeText={set('email')} />
                <Text style={s.hint}>OTP will be sent to this email.</Text>
              </View>

              <View style={s.inputGroup}>
                <Text style={s.label}>Mobile Number</Text>
                <TextInput style={s.input} placeholder="9876543210" keyboardType="phone-pad" value={form.phone} onChangeText={set('phone')} />
              </View>

              <View style={s.row}>
                <View style={[s.inputGroup, { flex: 1 }]}>
                  <Text style={s.label}>Password *</Text>
                  <TextInput style={s.input} placeholder="Min. 8 chars" secureTextEntry value={form.password} onChangeText={set('password')} />
                </View>
                <View style={[s.inputGroup, { flex: 1 }]}>
                  <Text style={s.label}>Confirm Password *</Text>
                  <TextInput style={s.input} placeholder="••••••••" secureTextEntry value={form.confirmPassword} onChangeText={set('confirmPassword')} />
                </View>
              </View>

              <TouchableOpacity
                style={[s.btn, (sending || (mode === 'employee' && !companyPreview)) && s.btnDisabled]}
                onPress={handleContinue}
                disabled={sending || (mode === 'employee' && !companyPreview)}
              >
                {sending ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Continue — Send OTP</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity style={s.backBtn} onPress={() => { setStep(1); setOtp(''); setError(''); setSuccessMsg(''); }}>
                <Ionicons name="arrow-back" size={14} color={C.muted} />
                <Text style={s.backBtnText}>Edit details</Text>
              </TouchableOpacity>

              <View style={s.otpSentCard}>
                <Ionicons name="mail" size={20} color={C.primary} />
                <View>
                  <Text style={s.otpSentTitle}>OTP sent to</Text>
                  <Text style={s.otpSentEmail}>{form.email.trim().toLowerCase()}</Text>
                </View>
              </View>

              <Text style={s.label}>Enter 6-Digit OTP</Text>
              <OtpBoxes value={otp} onChange={setOtp} />
              <Text style={[s.hint, { textAlign: 'center', marginBottom: 16 }]}>OTP expires in 5 minutes</Text>

              <TouchableOpacity style={[s.btn, (verifying || otp.length !== 6) && s.btnDisabled]} onPress={handleVerifyAndCreate} disabled={verifying || otp.length !== 6}>
                {verifying ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Verify OTP</Text>}
              </TouchableOpacity>

              <View style={{ alignItems: 'center', marginTop: 14 }}>
                <ResendTimer onResend={handleResend} loading={sending} />
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Resume path: already authenticated but no profile row exists yet (e.g. an
// invite that hasn't been provisioned, or a signup that got interrupted before
// the workspace RPC ran). No self-service founder/employee choice here — profile
// creation is an admin action; this just explains the state and offers a way out.
function WorkspaceStep({ onSignOut }: { onSignOut: () => void }) {
  const { refreshProfile } = useAuth();
  const [checking, setChecking] = useState(false);

  const handleRetry = async () => {
    setChecking(true);
    try {
      const data = await refreshProfile();
      if (!data) showToast("Still not set up — please check with your admin.", 'error');
    } finally {
      setChecking(false);
    }
  };

  return (
    <View style={[s.container, { justifyContent: 'center' }]}>
      <View style={s.successWrap}>
        <View style={s.successIconWrap}>
          <Ionicons name="alert-circle-outline" size={44} color={C.primary} />
        </View>
        <Text style={s.successTitle}>Account Not Set Up</Text>
        <Text style={s.successSubtitle}>
          Your account isn't linked to a company yet. Please contact your admin or HR to get added.
        </Text>
        <TouchableOpacity style={[s.btn, { width: '100%' }, checking && s.btnDisabled]} onPress={handleRetry} disabled={checking}>
          {checking ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>I've Been Added — Check Again</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={{ marginTop: 20 }} onPress={onSignOut}>
          <Text style={{ color: C.danger, fontWeight: '600', fontSize: 14 }}>Not your account? Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Entry point ────────────────────────────────────────────────────────────────
export default function RegisterScreen() {
  const { user, profile, loading, refreshProfile, signOut } = useAuth();
  const router = useRouter();
  // True while SignupFlow's own verify-and-create-workspace call is in flight —
  // suppresses the `user && !profile` -> WorkspaceStep swap below, which would
  // otherwise race AuthContext's profile fetch and unmount SignupFlow before it
  // can show the "Workspace Created!" join-code screen. See SignupFlow.
  const [isSigningUp, setIsSigningUp] = useState(false);

  useEffect(() => {
    if (!loading && user && profile) router.replace('/(tabs)' as any);
  }, [user, profile, loading]);

  const handleDone = useCallback(async () => {
    await refreshProfile();
    router.replace('/(tabs)' as any);
  }, [refreshProfile, router]);

  if (loading) {
    return (
      <View style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  if (user && !profile && !isSigningUp) {
    return <WorkspaceStep onSignOut={signOut} />;
  }

  return <SignupFlow onDone={handleDone} onSigningUpChange={setIsSigningUp} />;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, padding: 24, paddingTop: 40 },
  header: { marginBottom: 20, paddingHorizontal: 24, paddingTop: 40 },
  title: { fontSize: 24, fontWeight: '800', color: C.text },
  subtitle: { fontSize: 14, color: C.muted, marginTop: 6 },

  modeToggle: {
    flexDirection: 'row', backgroundColor: C.surface, borderRadius: 14,
    padding: 4, gap: 4, marginHorizontal: 24, marginBottom: 16,
    borderWidth: 1, borderColor: C.border,
  },
  modeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 11,
  },
  modeBtnActive: { backgroundColor: C.primary },
  modeBtnText: { fontSize: 12.5, fontWeight: '600', color: C.muted },
  modeBtnTextActive: { color: '#fff' },

  formCard: {
    backgroundColor: C.surface, padding: 24, borderRadius: 24,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16, elevation: 4,
  },

  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 20, gap: 0 },
  stepItem: { alignItems: 'center', gap: 4 },
  stepDot: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.bg, borderWidth: 2, borderColor: C.border,
  },
  stepDotActive: { backgroundColor: C.primary, borderColor: C.primary },
  stepNum: { fontSize: 11, fontWeight: '700', color: C.muted },
  stepNumActive: { color: '#fff' },
  stepLabel: { fontSize: 10, fontWeight: '600', color: C.muted },
  stepLabelActive: { color: C.primary },
  stepLine: { height: 2, width: 36, marginBottom: 16, backgroundColor: C.border },
  stepLineActive: { backgroundColor: C.primary },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF2F2', borderRadius: 10, padding: 10, marginBottom: 14,
  },
  bannerSuccess: { backgroundColor: '#F0FDF4' },
  bannerText: { flex: 1, fontSize: 12.5, color: C.danger },

  row: { flexDirection: 'row', gap: 12 },
  inputGroup: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 6 },
  input: {
    backgroundColor: '#F8FAFC', borderWidth: 1.5, borderColor: C.border,
    borderRadius: 12, padding: 13, fontSize: 14, color: C.text,
  },
  hint: { fontSize: 11, color: C.muted, marginTop: 5 },

  orgCodeWrap: { position: 'relative', justifyContent: 'center' },
  orgCodeInput: { textTransform: 'uppercase', letterSpacing: 3, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  orgCodeSpinner: { position: 'absolute', right: 12 },
  orgCodeFound: { marginTop: 6, fontSize: 12, color: C.success, fontWeight: '600' },
  orgCodeNotFound: { marginTop: 6, fontSize: 12, color: C.danger, fontWeight: '600' },

  btn: {
    backgroundColor: C.primary, padding: 16, borderRadius: 14,
    alignItems: 'center', marginTop: 8,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  backBtnText: { fontSize: 13, fontWeight: '600', color: C.muted },

  otpSentCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.bg, borderRadius: 12, padding: 14, marginBottom: 18,
  },
  otpSentTitle: { fontSize: 13, fontWeight: '600', color: C.text },
  otpSentEmail: { fontSize: 12, color: C.muted, marginTop: 2 },

  resendText: { fontSize: 12, color: C.muted },
  resendLink: { fontSize: 12, color: C.primary, fontWeight: '700' },

  optionCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, padding: 20, borderRadius: 20,
    gap: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  optionIcon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  optionDesc: { fontSize: 12, color: C.muted, marginTop: 4 },

  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  successIconWrap: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: C.success + '15',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  successTitle: { fontSize: 22, fontWeight: '800', color: C.text, marginBottom: 8 },
  successSubtitle: { fontSize: 14, color: C.muted, textAlign: 'center', marginBottom: 20 },
  joinCodeBox: {
    backgroundColor: C.bg, borderRadius: 16, padding: 20, marginBottom: 24,
    alignItems: 'center', width: '100%',
  },
  joinCodeLabel: { fontSize: 12, color: C.muted, marginBottom: 10, textAlign: 'center' },
  joinCodeText: {
    fontSize: 30, fontWeight: '800', letterSpacing: 6, color: C.primary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  joinCodeHint: { fontSize: 11, color: C.muted, marginTop: 10, textAlign: 'center' },
});
