import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert,
  Animated, Dimensions, Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { detectIdentifierType } from '@/services/otpService';
import { Colors as C } from '@/constants/Colors';

const { width: W, height: H } = Dimensions.get('window');

function OtpBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<TextInput>(null);
  const digits = value.padEnd(8, ' ').split('').slice(0, 8);
  const boxAnims = useRef(Array.from({ length: 8 }, () => new Animated.Value(1))).current;

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const idx = Math.min(value.length, 7);
    if (value.length > 0) {
      Animated.sequence([
        Animated.timing(boxAnims[idx], { toValue: 1.12, duration: 100, useNativeDriver: true }),
        Animated.timing(boxAnims[idx], { toValue: 1, duration: 100, useNativeDriver: true }),
      ]).start();
    }
  }, [value]);

  return (
    <TouchableOpacity
      style={s.otpRow}
      onPress={() => inputRef.current?.focus()}
      activeOpacity={1}
    >
      {digits.map((d, i) => (
        <Animated.View
          key={i}
          style={[
            s.otpBox,
            d.trim() ? s.otpBoxFilled : null,
            i === value.length && s.otpBoxActive,
            { transform: [{ scale: boxAnims[i] }] },
          ]}
        >
          <Text style={s.otpDigit}>{d.trim()}</Text>
        </Animated.View>
      ))}
      <TextInput
        ref={inputRef}
        style={s.otpHidden}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 8))}
        keyboardType="number-pad"
        maxLength={8}
        caretHidden
      />
    </TouchableOpacity>
  );
}

export default function LoginScreen() {
  const { signIn, sendOtp, verifyOtp, user, profile, loading } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [idType, setIdType] = useState<'email' | 'phone' | null>(null);
  const [otpStep, setOtpStep] = useState(1);
  const [otp, setOtp] = useState('');
  const [resolvedId, setResolvedId] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Entrance animations
  const logoAnim = useRef(new Animated.Value(0)).current;
  const formAnim = useRef(new Animated.Value(0)).current;
  const formTranslate = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(logoAnim, { toValue: 1, duration: 600, easing: Easing.out(Easing.back(1.3)), useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(formAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(formTranslate, { toValue: 0, duration: 400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  useEffect(() => {
    if (!loading && user && profile) {
      router.replace('/' as any);
    }
  }, [user, profile, loading]);

  // Always land on a clean, empty form — e.g. right after signing out.
  useFocusEffect(
    useCallback(() => {
      if (!user) {
        setMode('password');
        setEmail('');
        setPassword('');
        setShowPass(false);
        setIdentifier('');
        setIdType(null);
        setOtpStep(1);
        setOtp('');
        setResolvedId('');
        setError('');
        setSuccessMsg('');
      }
    }, [user])
  );

  const handlePasswordLogin = useCallback(async () => {
    setError('');
    if (!email || !password) { setError('Please enter your email/phone and password.'); return; }
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch (err: any) {
      setError(err.message || 'Invalid email or password.');
    } finally {
      setSubmitting(false);
    }
  }, [email, password, signIn]);

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

  const handleVerifyOtp = useCallback(async () => {
    setError('');
    if (otp.length !== 8) { setError('Please enter the complete 8-digit OTP.'); return; }
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
    if (otpStep === 2 && otp.length === 8 && !submitting) handleVerifyOtp();
  }, [otp]);

  if (loading) {
    return (
      <View style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <View style={s.loadingLogo}>
          <Ionicons name="briefcase" size={28} color="#fff" />
        </View>
        <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 24 }} />
        <Text style={[s.muted, { marginTop: 12 }]}>Loading workspace…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* ── Dark hero top ── */}
        <View style={s.heroTop}>
          <View style={s.heroDecor} />
          <View style={s.heroDecor2} />
          {/* Logo */}
          <Animated.View style={[s.logoWrap, { opacity: logoAnim, transform: [{ scale: logoAnim }] }]}>
            <View style={s.logoIcon}>
              <Ionicons name="briefcase" size={30} color="#fff" />
            </View>
            <Text style={s.logoName}>CrewCore</Text>
            <Text style={s.logoTagline}>Smart Payroll for Modern Teams</Text>
          </Animated.View>
        </View>

        {/* ── Form card ── */}
        <Animated.View style={[s.card, { opacity: formAnim, transform: [{ translateY: formTranslate }] }]}>
          <Text style={s.title}>Welcome back</Text>
          <Text style={s.subtitle}>Sign in to your company workspace</Text>

          {/* Mode toggle */}
          <View style={s.toggleRow}>
            {(['password', 'otp'] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[s.toggleBtn, mode === m && s.toggleActive]}
                onPress={() => { setMode(m); setError(''); setSuccessMsg(''); }}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={m === 'password' ? 'lock-closed-outline' : 'phone-portrait-outline'}
                  size={14}
                  color={mode === m ? '#fff' : C.muted}
                />
                <Text style={[s.toggleText, mode === m && s.toggleTextActive]}>
                  {m === 'password' ? 'Password' : 'OTP Login'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Banners */}
          {!!error && (
            <View style={s.banner}>
              <View style={s.bannerIcon}>
                <Ionicons name="alert-circle" size={16} color="#fff" />
              </View>
              <Text style={s.bannerText}>{error}</Text>
            </View>
          )}
          {!!successMsg && (
            <View style={[s.banner, s.bannerSuccess]}>
              <View style={[s.bannerIcon, { backgroundColor: C.success }]}>
                <Ionicons name="checkmark-circle" size={16} color="#fff" />
              </View>
              <Text style={[s.bannerText, { color: C.success }]}>{successMsg}</Text>
            </View>
          )}

          {/* ── Password form ── */}
          {mode === 'password' && (
            <>
              <View style={s.group}>
                <Text style={s.label}>Email or Phone Number</Text>
                <View style={s.inputWrap}>
                  <View style={s.inputIconWrap}>
                    <Ionicons name={email.includes('@') ? 'mail-outline' : 'call-outline'} size={16} color={C.primary} />
                  </View>
                  <TextInput
                    style={s.input}
                    placeholder="you@company.com or 98765 43210"
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
                  <View style={s.inputIconWrap}>
                    <Ionicons name="lock-closed-outline" size={16} color={C.primary} />
                  </View>
                  <TextInput
                    style={[s.input, { paddingRight: 48 }]}
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

              <TouchableOpacity style={[s.btn, submitting && s.btnDisabled]} onPress={handlePasswordLogin} disabled={submitting} activeOpacity={0.85}>
                {submitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <Ionicons name="log-in-outline" size={18} color="#fff" />
                      <Text style={s.btnText}>Sign In</Text>
                    </>}
              </TouchableOpacity>
            </>
          )}

          {/* ── OTP Step 1 ── */}
          {mode === 'otp' && otpStep === 1 && (
            <>
              <View style={s.group}>
                <Text style={s.label}>Email Address</Text>
                <View style={s.inputWrap}>
                  <View style={s.inputIconWrap}>
                    <Ionicons name="mail-outline" size={16} color={C.primary} />
                  </View>
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
                    <View style={s.idTypeBadge}>
                      <Text style={s.idTypeBadgeText}>{idType.toUpperCase()}</Text>
                    </View>
                  )}
                </View>
                <Text style={s.hint}>We'll send an 8-digit OTP to your email.</Text>
              </View>

              <TouchableOpacity
                style={[s.btn, (!idType || submitting) && s.btnDisabled]}
                onPress={handleSendOtp}
                disabled={submitting || !idType}
                activeOpacity={0.85}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <Ionicons name="paper-plane-outline" size={18} color="#fff" />
                      <Text style={s.btnText}>Send OTP</Text>
                    </>}
              </TouchableOpacity>
            </>
          )}

          {/* ── OTP Step 2 ── */}
          {mode === 'otp' && otpStep === 2 && (
            <>
              <View style={s.otpHeader}>
                <View style={s.otpHeaderIcon}>
                  <Ionicons name="mail" size={20} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.otpHeaderTitle}>OTP Sent</Text>
                  <Text style={s.otpHeaderSub}>Check <Text style={{ fontWeight: '700', color: C.text }}>{resolvedId}</Text></Text>
                </View>
              </View>

              <OtpBoxes value={otp} onChange={setOtp} />

              <TouchableOpacity
                style={[s.btn, (submitting || otp.length !== 8) && s.btnDisabled]}
                onPress={handleVerifyOtp}
                disabled={submitting || otp.length !== 8}
                activeOpacity={0.85}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <Ionicons name="shield-checkmark-outline" size={18} color="#fff" />
                      <Text style={s.btnText}>Verify OTP</Text>
                    </>}
              </TouchableOpacity>

              <View style={s.otpFooter}>
                <TouchableOpacity onPress={handleSendOtp} disabled={submitting}>
                  <Text style={[s.link, submitting && { opacity: 0.5 }]}>Resend OTP</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setOtpStep(1); setOtp(''); setError(''); setSuccessMsg(''); }}>
                  <Text style={s.link}>← Change Email</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* Trust badges */}
          <View style={s.trustRow}>
            {[
              { icon: 'shield-checkmark-outline' as const, label: 'Secure' },
              { icon: 'business-outline' as const, label: 'Multi-tenant' },
              { icon: 'lock-closed-outline' as const, label: 'Encrypted' },
            ].map((t) => (
              <View key={t.label} style={s.trustItem}>
                <Ionicons name={t.icon} size={11} color={C.primaryLight} />
                <Text style={s.trustText}>{t.label}</Text>
              </View>
            ))}
          </View>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.dark },
  scroll: { flexGrow: 1 },

  // Hero top
  heroTop: {
    backgroundColor: C.dark,
    paddingTop: 60, paddingBottom: 48,
    alignItems: 'center',
    overflow: 'hidden',
  },
  heroDecor: {
    position: 'absolute', top: -60, right: -60,
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: C.primary, opacity: 0.15,
  },
  heroDecor2: {
    position: 'absolute', bottom: -40, left: -40,
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: C.primaryLight, opacity: 0.08,
  },
  logoWrap: { alignItems: 'center' },
  logoIcon: {
    width: 68, height: 68, borderRadius: 22,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOpacity: 0.6, shadowRadius: 20, elevation: 12,
    marginBottom: 14,
  },
  logoName: { fontSize: 30, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  logoTagline: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 4 },
  loadingLogo: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },

  // Form card
  card: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 32, borderTopRightRadius: 32,
    padding: 28, paddingTop: 32,
    shadowColor: C.dark, shadowOpacity: 0.2, shadowRadius: 24, elevation: 10,
    minHeight: H * 0.55,
  },
  title: { fontSize: 22, fontWeight: '800', color: C.text, textAlign: 'center' },
  subtitle: { fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 4, marginBottom: 22 },

  // Toggle
  toggleRow: {
    flexDirection: 'row', backgroundColor: '#F5F3FF', borderRadius: 14,
    padding: 4, gap: 4, marginBottom: 20,
  },
  toggleBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 11,
  },
  toggleActive: {
    backgroundColor: C.primary,
    shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  toggleText: { fontSize: 13, fontWeight: '600', color: C.muted },
  toggleTextActive: { color: '#fff' },

  // Banner
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FEF2F2', borderRadius: 12, padding: 12, marginBottom: 16,
    borderLeftWidth: 3, borderLeftColor: C.danger,
  },
  bannerIcon: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: C.danger, alignItems: 'center', justifyContent: 'center',
  },
  bannerSuccess: { backgroundColor: '#F0FDF4', borderLeftColor: C.success },
  bannerText: { flex: 1, fontSize: 13, color: C.danger },

  // Form fields
  group: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 7 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: C.border, borderRadius: 14,
    backgroundColor: '#FAFAFA', overflow: 'hidden',
  },
  inputIconWrap: {
    width: 44, alignItems: 'center', justifyContent: 'center',
    borderRightWidth: 1, borderRightColor: C.border,
    paddingVertical: 13,
  },
  input: { flex: 1, paddingVertical: 13, paddingHorizontal: 12, fontSize: 14, color: C.text },
  eyeBtn: { padding: 12 },
  idTypeBadge: {
    backgroundColor: C.primaryBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginRight: 10,
  },
  idTypeBadgeText: { fontSize: 10, fontWeight: '700', color: C.primary },
  hint: { fontSize: 11, color: C.muted, marginTop: 5 },

  // Button
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.primary, borderRadius: 16, paddingVertical: 15,
    gap: 8, marginTop: 4,
    shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // OTP
  otpHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.primaryBg, borderRadius: 14, padding: 14, marginBottom: 20,
  },
  otpHeaderIcon: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOpacity: 0.15, shadowRadius: 6, elevation: 2,
  },
  otpHeaderTitle: { fontSize: 14, fontWeight: '700', color: C.primary },
  otpHeaderSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  otpRow: { flexDirection: 'row', gap: 7, justifyContent: 'center', marginBottom: 20 },
  otpBox: {
    width: 36, height: 48, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.border,
    backgroundColor: '#FAFAFA', alignItems: 'center', justifyContent: 'center',
  },
  otpBoxFilled: { borderColor: C.primary, backgroundColor: C.primaryBg },
  otpBoxActive: { borderColor: C.primary, borderWidth: 2 },
  otpDigit: { fontSize: 18, fontWeight: '800', color: C.text },
  otpHidden: { position: 'absolute', opacity: 0, width: 1, height: 1 },
  otpFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  link: { fontSize: 13, color: C.primary, fontWeight: '600' },
  muted: { fontSize: 13, color: C.muted },

  // Trust row
  trustRow: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 24, flexWrap: 'wrap' },
  trustItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trustText: { fontSize: 11, color: C.muted },
});
