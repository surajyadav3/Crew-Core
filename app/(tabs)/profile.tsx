import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Animated, Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { fmt, fmtDate, fmtTime12 } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

// Masks all but the last 4 characters of a sensitive ID (PAN/Aadhar/bank account),
// e.g. "1234 5678 9012" -> "•••• •••• 9012". Mirrors the reveal/hide pattern already
// used for Salary so PII isn't shown in full by default (shoulder-surfing risk).
function maskTail(value: string, visible = 4) {
  const v = (value || '').trim();
  if (!v) return '—';
  if (v.length <= visible) return v;
  const tail = v.slice(-visible);
  const maskedLen = v.length - visible;
  return `${'•'.repeat(Math.min(maskedLen, 12))} ${tail}`;
}

function InfoRow({
  icon, label, value, last = false,
}: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; last?: boolean }) {
  return (
    <View>
      <View style={s.infoRow}>
        <View style={s.infoIconWrap}>
          <Ionicons name={icon} size={15} color={C.primary} />
        </View>
        <View style={s.infoContent}>
          <Text style={s.infoLabel}>{label}</Text>
          <Text style={s.infoValue}>{value || '—'}</Text>
        </View>
      </View>
      {!last && <View style={s.divider} />}
    </View>
  );
}

function QuickLinkRow({
  icon, label, color, bg, onPress, last = false,
}: { icon: keyof typeof Ionicons.glyphMap; label: string; color: string; bg: string; onPress: () => void; last?: boolean }) {
  return (
    <View>
      <TouchableOpacity style={s.linkRow} onPress={onPress} activeOpacity={0.75}>
        <View style={[s.linkIconWrap, { backgroundColor: bg }]}>
          <Ionicons name={icon} size={17} color={color} />
        </View>
        <Text style={s.linkLabel}>{label}</Text>
        <View style={s.linkArrow}>
          <Ionicons name="chevron-forward" size={14} color={C.muted} />
        </View>
      </TouchableOpacity>
      {!last && <View style={s.divider} />}
    </View>
  );
}

export default function ProfileScreen() {
  const { profile, tenant } = useAuth();
  const router = useRouter();
  const [showSalary, setShowSalary] = useState(false);
  const [showSensitive, setShowSensitive] = useState(false);
  const [managerName, setManagerName] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.manager_id) { setManagerName(null); return; }
    let cancelled = false;
    supabase
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', profile.manager_id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setManagerName([data.first_name, data.last_name].filter(Boolean).join(' '));
      });
    return () => { cancelled = true; };
  }, [profile?.manager_id]);
  const headerAnim = useRef(new Animated.Value(0)).current;
  const cardsAnim = useRef(new Animated.Value(0)).current;
  const salaryAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.stagger(120, [
      Animated.timing(headerAnim, { toValue: 1, duration: 500, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(cardsAnim, { toValue: 1, duration: 500, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, []);

  const initials = [profile?.first_name?.[0], profile?.last_name?.[0]]
    .filter(Boolean).join('').toUpperCase() || '?';

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'User';

  const roleLabel = (r: string) => {
    if (r === 'superadmin') return 'Super Admin';
    if (r === 'admin') return 'Admin / HR';
    if (r === 'manager') return 'Manager';
    return 'Employee';
  };

  const shiftLabel = () => {
    const st = tenant?.shift_start ? fmtTime12(tenant.shift_start) : null;
    const en = tenant?.shift_end ? fmtTime12(tenant.shift_end) : null;
    if (st && en) return `${st} – ${en}`;
    if (st) return `From ${st}`;
    return '—';
  };

  const toggleSalary = () => {
    const next = !showSalary;
    setShowSalary(next);
    Animated.spring(salaryAnim, {
      toValue: next ? 1 : 0, useNativeDriver: true, damping: 14, stiffness: 180,
    }).start();
  };

  const ROLE_COLORS: Record<string, { color: string; bg: string }> = {
    superadmin: { color: C.danger, bg: C.dangerBg },
    admin: { color: C.purple, bg: '#EDE9FE' },
    manager: { color: '#F97316', bg: '#FFEDD5' },
    employee: { color: C.primary, bg: C.primaryBg },
  };
  const roleStyle = ROLE_COLORS[profile?.role || 'employee'] || ROLE_COLORS.employee;

  const headerTranslate = headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] });
  const cardsTranslate = cardsAnim.interpolate({ inputRange: [0, 1], outputRange: [30, 0] });

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}>

        {/* ── Hero section ── */}
        <Animated.View style={[s.hero, { opacity: headerAnim, transform: [{ translateY: headerTranslate }] }]}>
          <View style={s.heroDecor1} />
          <View style={s.heroDecor2} />

          {/* Avatar with ring */}
          <View style={s.avatarRing}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
          </View>

          <Text style={s.heroName}>{fullName}</Text>

          {/* Role badge */}
          <View style={[s.roleBadge, { backgroundColor: roleStyle.bg }]}>
            <View style={[s.roleDot, { backgroundColor: roleStyle.color }]} />
            <Text style={[s.roleText, { color: roleStyle.color }]}>{roleLabel(profile?.role || '')}</Text>
          </View>

          {tenant && (
            <View style={s.companyChip}>
              <Ionicons name="business-outline" size={12} color="rgba(255,255,255,0.5)" />
              <Text style={s.companyText}>{tenant.company_name}</Text>
            </View>
          )}

          {/* Stats row */}
          <View style={s.heroStats}>
            {[
              { label: 'Department', value: profile?.department || '—', icon: 'briefcase-outline' as const },
              { label: 'Designation', value: profile?.designation || '—', icon: 'ribbon-outline' as const },
              { label: 'Joined', value: fmtDate(profile?.created_at), icon: 'calendar-outline' as const },
            ].map((item, idx) => (
              <View key={item.label} style={[s.heroStat, idx < 2 && s.heroStatBorder]}>
                <Ionicons name={item.icon} size={13} color="rgba(255,255,255,0.4)" />
                <Text style={s.heroStatVal} numberOfLines={1}>{item.value}</Text>
                <Text style={s.heroStatLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
        </Animated.View>

        {/* ── Cards ── */}
        <Animated.View style={{ opacity: cardsAnim, transform: [{ translateY: cardsTranslate }] }}>

          {/* Personal Details */}
          <View style={s.section}>
            <View style={s.sectionTitleRow}>
              <View style={[s.sectionTitleDot, { backgroundColor: C.primary }]} />
              <Text style={s.sectionTitle}>Personal Details</Text>
            </View>
            <View style={s.card}>
              <InfoRow icon="person-outline" label="Full Name" value={fullName} />
              <InfoRow icon="mail-outline" label="Email" value={profile?.email || '—'} />
              <InfoRow icon="call-outline" label="Phone No." value={profile?.phone || '—'} />
              <InfoRow icon="calendar-outline" label="Joined" value={fmtDate(profile?.created_at)} last />
            </View>
          </View>

          {/* Verification & Bank Details */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={s.sectionTitleRow}>
                <View style={[s.sectionTitleDot, { backgroundColor: C.purple }]} />
                <Text style={s.sectionTitle}>Verification & Bank Details</Text>
              </View>
              <TouchableOpacity style={s.revealBtn} onPress={() => setShowSensitive((v) => !v)} activeOpacity={0.8}>
                <Ionicons name={showSensitive ? 'eye-off-outline' : 'eye-outline'} size={14} color={C.primary} />
                <Text style={s.revealText}>{showSensitive ? 'Hide' : 'Show'}</Text>
              </TouchableOpacity>
            </View>
            <View style={s.card}>
              <InfoRow icon="wallet-outline" label="Bank A/C No." value={showSensitive ? (profile?.bank_acc || '—') : maskTail(profile?.bank_acc || '')} />
              <InfoRow icon="document-text-outline" label="PAN No." value={showSensitive ? (profile?.pan || '—') : maskTail(profile?.pan || '')} />
              <InfoRow icon="finger-print" label="Aadhar No." value={showSensitive ? (profile?.aadhar || '—') : maskTail(profile?.aadhar || '')} last />
            </View>
          </View>

          {/* Work Info */}
          <View style={s.section}>
            <View style={s.sectionTitleRow}>
              <View style={[s.sectionTitleDot, { backgroundColor: C.success }]} />
              <Text style={s.sectionTitle}>Work Info</Text>
            </View>
            <View style={s.card}>
              <InfoRow icon="business-outline" label="Company" value={tenant?.company_name || '—'} />
              <InfoRow icon="briefcase-outline" label="Department" value={profile?.department || '—'} />
              <InfoRow icon="ribbon-outline" label="Designation" value={profile?.designation || '—'} />
              <InfoRow icon="person-circle-outline" label="Reporting Manager" value={managerName || (profile?.manager_id ? '—' : 'Not assigned')} />
              <InfoRow icon="people-outline" label="Role" value={roleLabel(profile?.role || '')} />
              <InfoRow icon="checkmark-circle-outline" label="Status" value={profile?.status || '—'} />
              <InfoRow icon="time-outline" label="Shift Hours" value={shiftLabel()} />
              <InfoRow icon="hourglass-outline" label="Probation Period" value={profile?.probation_months ? `${profile.probation_months} Month(s)` : 'None'} />
              <InfoRow icon="calendar-outline" label="Weekly Holiday" value={profile?.weekly_holiday || '—'} last={!profile?.comp_off_balance || profile.comp_off_balance <= 0} />
              {profile?.comp_off_balance != null && profile.comp_off_balance > 0 && (
                <InfoRow icon="gift-outline" label="Comp Off Balance" value={`${profile.comp_off_balance} day${profile.comp_off_balance !== 1 ? 's' : ''}`} last />
              )}
            </View>
          </View>

          {/* Salary */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={s.sectionTitleRow}>
                <View style={[s.sectionTitleDot, { backgroundColor: C.success }]} />
                <Text style={s.sectionTitle}>Salary</Text>
              </View>
              <TouchableOpacity style={s.revealBtn} onPress={toggleSalary} activeOpacity={0.8}>
                <Ionicons name={showSalary ? 'eye-off-outline' : 'eye-outline'} size={14} color={C.primary} />
                <Text style={s.revealText}>{showSalary ? 'Hide' : 'Show'}</Text>
              </TouchableOpacity>
            </View>
            <View style={[s.card, s.salaryCard]}>
              <View style={s.salaryCardDecor} />
              <View style={s.salaryIconWrap}>
                <Ionicons name="wallet-outline" size={22} color={C.primary} />
              </View>
              <View style={s.salaryInfo}>
                <Text style={s.salaryLabel}>Monthly CTC</Text>
                <Animated.Text style={[s.salaryValue, {
                  opacity: salaryAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
                }]}>
                  {showSalary ? fmt(profile?.ctc || 0) : '₹ ••••••'}
                </Animated.Text>
              </View>
              {showSalary && (
                <View style={s.salaryBadge}>
                  <Text style={s.salaryBadgeText}>Verified</Text>
                </View>
              )}
            </View>
          </View>

          {/* Quick Links */}
          <View style={s.section}>
            <View style={s.sectionTitleRow}>
              <View style={[s.sectionTitleDot, { backgroundColor: C.warning }]} />
              <Text style={s.sectionTitle}>Quick Links</Text>
            </View>
            <View style={s.card}>
              <QuickLinkRow
                icon="document-text-outline" label="My Payslips"
                color={C.success} bg={C.successBg}
                onPress={() => router.push('/payslips' as any)}
              />
              <QuickLinkRow
                icon="calendar-outline" label="My Leaves"
                color={C.primary} bg={C.primaryBg}
                onPress={() => router.push('/leaves' as any)}
              />
              <QuickLinkRow
                icon="flash-outline" label="My Requests"
                color={C.purple} bg="#EDE9FE"
                onPress={() => router.push('/requests' as any)}
              />
              <QuickLinkRow
                icon="create-outline" label="Edit Profile Details"
                color={C.teal} bg={C.tealBg}
                onPress={() => router.push('/profile-details' as any)}
              />
              <QuickLinkRow
                icon="apps-outline" label="More Tools"
                color={C.amber} bg={C.amberBg}
                onPress={() => router.push('/more' as any)}
                last
              />
            </View>
          </View>

          {/* App info */}
          <View style={s.appInfo}>
            <View style={s.appInfoLogo}>
              <Ionicons name="briefcase" size={14} color={C.primary} />
            </View>
            <Text style={s.appInfoName}>CrewCore</Text>
            <Text style={s.appInfoVersion}>v1.0 · Smart Payroll for Modern Teams</Text>
          </View>

        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.dark },
  scroll: { flex: 1, backgroundColor: C.bg },

  // Hero
  hero: {
    backgroundColor: C.dark,
    alignItems: 'center',
    paddingTop: 20, paddingBottom: 24,
    paddingHorizontal: 20,
    overflow: 'hidden',
  },
  heroDecor1: {
    position: 'absolute', top: -50, right: -50,
    width: 180, height: 180, borderRadius: 90,
    backgroundColor: C.primary, opacity: 0.1,
  },
  heroDecor2: {
    position: 'absolute', bottom: -30, left: -30,
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: C.primaryLight, opacity: 0.06,
  },
  avatarRing: {
    width: 96, height: 96, borderRadius: 48,
    borderWidth: 3, borderColor: 'rgba(108,92,231,0.35)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
    shadowColor: C.primary, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
  },
  avatar: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 34, fontWeight: '900', color: '#fff' },
  heroName: { fontSize: 24, fontWeight: '900', color: '#fff', marginBottom: 8 },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 10,
  },
  roleDot: { width: 7, height: 7, borderRadius: 3.5 },
  roleText: { fontSize: 12.5, fontWeight: '700' },
  companyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, marginBottom: 18,
  },
  companyText: { fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: '500' },

  // Hero stats
  heroStats: {
    flexDirection: 'row', width: '100%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 18, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  heroStat: { flex: 1, alignItems: 'center', paddingVertical: 12, gap: 4 },
  heroStatBorder: { borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.08)' },
  heroStatVal: { fontSize: 12, fontWeight: '700', color: '#fff', textAlign: 'center' },
  heroStatLabel: { fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: '500' },

  // Section
  section: { paddingHorizontal: 14, marginTop: 18 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitleDot: { width: 4, height: 16, borderRadius: 2 },
  sectionTitle: { fontSize: 11.5, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  revealBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  revealText: { fontSize: 13, color: C.primary, fontWeight: '600' },

  // Card
  card: {
    backgroundColor: C.surface, borderRadius: 18, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  infoIconWrap: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center', marginRight: 12, flexShrink: 0,
  },
  infoContent: { flex: 1 },
  infoLabel: { fontSize: 11, color: C.muted, fontWeight: '500', marginBottom: 3 },
  infoValue: { fontSize: 14, color: C.text, fontWeight: '600' },
  divider: { height: 1, backgroundColor: C.border, marginHorizontal: 16 },

  // Salary card
  salaryCard: {
    flexDirection: 'row', alignItems: 'center',
    padding: 18, overflow: 'hidden', position: 'relative',
  },
  salaryCardDecor: {
    position: 'absolute', right: -20, top: -20,
    width: 90, height: 90, borderRadius: 45, backgroundColor: C.primary, opacity: 0.08,
  },
  salaryIconWrap: {
    width: 48, height: 48, borderRadius: 16, backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  salaryInfo: { flex: 1 },
  salaryLabel: { fontSize: 11, color: C.muted, fontWeight: '600', marginBottom: 4 },
  salaryValue: { fontSize: 22, fontWeight: '900', color: C.text },
  salaryBadge: {
    backgroundColor: C.successBg, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  salaryBadgeText: { fontSize: 11, fontWeight: '700', color: C.success },

  // Quick links
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  linkIconWrap: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  linkLabel: { flex: 1, fontSize: 14, color: C.text, fontWeight: '600' },
  linkArrow: {
    width: 28, height: 28, borderRadius: 9, backgroundColor: C.bg,
    alignItems: 'center', justifyContent: 'center',
  },

  // App info footer
  appInfo: {
    alignItems: 'center', paddingVertical: 24, gap: 6, marginTop: 4,
  },
  appInfoLogo: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center',
  },
  appInfoName: { fontSize: 14, fontWeight: '800', color: C.text },
  appInfoVersion: { fontSize: 11, color: C.muted },
});
