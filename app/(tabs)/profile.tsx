import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Animated, Easing,
  Modal, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { fmt, fmtDate, fmtTime12, getTenantWeeklyOffDays, upper, personName, probationInfo } from '@/lib/helpers';
import { getOutlet } from '@/services/tenantService';
import { showToast } from '@/components/Toast';
import { useMyShift } from '@/hooks/useMyShift';
import {
  listMyVerificationRequests, submitVerificationRequest, listTeamVerificationRequests, type FieldGroup,
} from '@/services/verificationRequestService';
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

type VerifyStatus = 'verified' | 'pending' | 'unverified';

function VerifyBadge({ status }: { status: VerifyStatus }) {
  const sty = status === 'verified' ? { bg: C.successBg, color: C.success, label: 'Verified', icon: 'checkmark-circle' as const }
    : status === 'pending' ? { bg: C.warningBg, color: C.warning, label: 'Pending Review', icon: 'time' as const }
    : { bg: C.bg, color: C.muted, label: 'Not Verified', icon: 'alert-circle-outline' as const };
  return (
    <View style={[vs.badge, { backgroundColor: sty.bg }]}>
      <Ionicons name={sty.icon} size={11} color={sty.color} />
      <Text style={[vs.badgeText, { color: sty.color }]}>{sty.label}</Text>
    </View>
  );
}

// Like InfoRow, but tappable to edit — used for Bank/PAN/Aadhar, which route
// through a verification request instead of writing straight to the profile.
function VerifiableRow({
  icon, label, value, status, onPress, last = false,
}: {
  icon: keyof typeof Ionicons.glyphMap; label: string; value: string; status: VerifyStatus;
  onPress: () => void; last?: boolean;
}) {
  return (
    <View>
      <TouchableOpacity style={s.infoRow} onPress={onPress} activeOpacity={0.7}>
        <View style={s.infoIconWrap}>
          <Ionicons name={icon} size={15} color={C.primary} />
        </View>
        <View style={s.infoContent}>
          <Text style={s.infoLabel}>{label}</Text>
          <Text style={s.infoValue}>{value || '—'}</Text>
          <View style={{ marginTop: 5 }}><VerifyBadge status={status} /></View>
        </View>
        <Ionicons name="create-outline" size={16} color={C.muted} />
      </TouchableOpacity>
      {!last && <View style={s.divider} />}
    </View>
  );
}

const FIELD_GROUP_LABEL: Record<FieldGroup, string> = { bank: 'Bank Details', pan: 'PAN', aadhar: 'Aadhar' };

const vs = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: '700' },
});

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
  const { profile, tenant, refreshProfile } = useAuth();
  const myShift = useMyShift();
  const router = useRouter();
  const [showSalary, setShowSalary] = useState(false);
  const [showSensitive, setShowSensitive] = useState(false);
  const [managerName, setManagerName] = useState<string | null>(null);
  const [hodName, setHodName] = useState<string | null>(null);
  const [myOutlet, setMyOutlet] = useState<any>(null);
  const [pendingByGroup, setPendingByGroup] = useState<Record<FieldGroup, any | null>>({ bank: null, pan: null, aadhar: null });
  const [verifyModal, setVerifyModal] = useState<FieldGroup | null>(null);
  const [verifyForm, setVerifyForm] = useState({ bank_acc: '', bank_name: '', ifsc_code: '', pan: '', aadhar: '' });
  const [savingVerify, setSavingVerify] = useState(false);
  const [teamPending, setTeamPending] = useState<number | null>(null);

  const fetchPendingVerification = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await listMyVerificationRequests(profile.id);
    const byGroup: Record<FieldGroup, any | null> = { bank: null, pan: null, aadhar: null };
    (data || []).forEach((r: any) => { if (r.status === 'Pending' && !byGroup[r.field_group as FieldGroup]) byGroup[r.field_group as FieldGroup] = r; });
    setPendingByGroup(byGroup);
    // Reviewer entry point: RLS only returns other people's requests to HR or
    // their reporting manager, so any row here means this user can review.
    const { data: team } = await listTeamVerificationRequests(profile.id);
    setTeamPending(team.length > 0 ? team.filter((r: any) => r.status === 'Pending').length : null);
  }, [profile?.id]);

  // Re-read the profile too, so an approval made since the app opened shows
  // as Verified (and a reset shows as Not Verified) without a restart.
  useFocusEffect(useCallback(() => { fetchPendingVerification(); refreshProfile(); }, [fetchPendingVerification, refreshProfile]));

  const verifyStatus = (group: FieldGroup): VerifyStatus => {
    if (pendingByGroup[group]) return 'pending';
    const verifiedAt = group === 'bank' ? profile?.bank_verified_at : group === 'pan' ? profile?.pan_verified_at : profile?.aadhar_verified_at;
    return verifiedAt ? 'verified' : 'unverified';
  };

  const openVerifyModal = (group: FieldGroup) => {
    setVerifyForm({
      bank_acc: profile?.bank_acc || '', bank_name: profile?.bank_name || '', ifsc_code: profile?.ifsc_code || '',
      pan: profile?.pan || '', aadhar: profile?.aadhar || '',
    });
    setVerifyModal(group);
  };

  const submitVerifyEdit = async () => {
    if (!verifyModal || !profile?.id || !tenant?.id) return;
    const group = verifyModal;
    let oldValue: Record<string, string>, newValue: Record<string, string>;
    if (group === 'bank') {
      if (!/^\d{9,18}$/.test(verifyForm.bank_acc.trim())) { showToast('Bank account number must be 9-18 digits.', 'error'); return; }
      if (!verifyForm.bank_name.trim() || !verifyForm.ifsc_code.trim()) { showToast('Please fill in bank name and IFSC code.', 'error'); return; }
      oldValue = { bank_acc: profile?.bank_acc || '', bank_name: profile?.bank_name || '', ifsc_code: profile?.ifsc_code || '' };
      newValue = { bank_acc: verifyForm.bank_acc.trim(), bank_name: verifyForm.bank_name.trim(), ifsc_code: verifyForm.ifsc_code.trim().toUpperCase() };
    } else if (group === 'pan') {
      if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(verifyForm.pan.trim().toUpperCase())) { showToast('Enter a valid PAN (e.g. ABCDE1234F).', 'error'); return; }
      oldValue = { pan: profile?.pan || '' };
      newValue = { pan: verifyForm.pan.trim().toUpperCase() };
    } else {
      if (!/^\d{12}$/.test(verifyForm.aadhar.trim())) { showToast('Aadhar number must be 12 digits.', 'error'); return; }
      oldValue = { aadhar: profile?.aadhar || '' };
      newValue = { aadhar: verifyForm.aadhar.trim() };
    }
    setSavingVerify(true);
    try {
      const { error } = await submitVerificationRequest({ tenantId: tenant.id, profileId: profile.id, fieldGroup: group, oldValue, newValue });
      if (error) { showToast(error.message, 'error'); return; }
      showToast(`${FIELD_GROUP_LABEL[group]} update sent for verification.`, 'success');
      setVerifyModal(null);
      fetchPendingVerification();
    } finally {
      setSavingVerify(false);
    }
  };

  // Manager / HOD: the linked employee's name, else the display-only name
  // for someone with no employee record (e.g. ABHISHEK SIR) — see payroll
  // web repo migration 20260926_9_raniwala_manager_hod_display_names.sql.
  useEffect(() => {
    let cancelled = false;
    const load = async (id: string | null | undefined, fallback: string | null | undefined, set: (v: string | null) => void) => {
      if (!id) { set(fallback ? upper(fallback) : null); return; }
      const { data } = await supabase
        .from('profile_directory')
        .select('first_name, middle_name, last_name')
        .eq('id', id)
        .maybeSingle();
      if (!cancelled) set(data ? personName(data) : (fallback ? upper(fallback) : null));
    };
    load(profile?.manager_id, profile?.manager_display_name, setManagerName);
    load(profile?.hod_id, profile?.hod_display_name, setHodName);
    return () => { cancelled = true; };
  }, [profile?.manager_id, profile?.manager_display_name, profile?.hod_id, profile?.hod_display_name]);

  // Weekly off comes from the employee's outlet (e.g. Delhi: Monday), falling
  // back to the company setting — same rule as the attendance calendar.
  useEffect(() => {
    if (!profile?.outlet_id) { setMyOutlet(null); return; }
    getOutlet(profile.outlet_id).then(({ data }) => setMyOutlet(data));
  }, [profile?.outlet_id]);
  const weeklyOffLabel = getTenantWeeklyOffDays(tenant, myOutlet)
    .map((d) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d])
    .join(', ');
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

  const fullName = personName(profile, 'USER');
  const probation = probationInfo(profile?.join_date, profile?.probation_months);

  const roleLabel = (r: string) => {
    if (r === 'superadmin') return 'Super Admin';
    if (r === 'admin') return 'Admin / HR';
    if (r === 'manager') return 'Manager';
    if (r === 'hod') return 'Head of Department';
    if (r === 'management') return 'Management';
    return 'Employee';
  };

  const shiftLabel = () => {
    // The employee's own shift (assigned shift > outlet > company), not the
    // company default — factory staff were shown the office 10:20–7:15.
    const st = myShift.start ? fmtTime12(myShift.start) : null;
    const en = myShift.end ? fmtTime12(myShift.end) : null;
    if (st && en) return `${st} – ${en}${myShift.name ? ` (${myShift.name})` : ''}`;
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
          {!!profile?.employee_id && <Text style={s.heroEmpCode}>EMP CODE: {profile.employee_id}</Text>}

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
              { label: 'Department', value: upper(profile?.department) || '—', icon: 'briefcase-outline' as const },
              { label: 'Designation', value: upper(profile?.designation) || '—', icon: 'ribbon-outline' as const },
              { label: 'Date of Joining', value: fmtDate(profile?.join_date), icon: 'calendar-outline' as const },
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
              <InfoRow icon="id-card-outline" label="Employee Code" value={profile?.employee_id || '—'} />
              <InfoRow icon="mail-outline" label="Email" value={profile?.email || '—'} />
              <InfoRow icon="call-outline" label="Phone No." value={profile?.phone || '—'} />
              <InfoRow icon="calendar-outline" label="Date of Joining" value={fmtDate(profile?.join_date)} last />
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
              <VerifiableRow
                icon="wallet-outline" label="Bank A/C No."
                value={showSensitive ? (profile?.bank_acc || '—') : maskTail(profile?.bank_acc || '')}
                status={verifyStatus('bank')} onPress={() => openVerifyModal('bank')}
              />
              <VerifiableRow
                icon="document-text-outline" label="PAN No."
                value={showSensitive ? (profile?.pan || '—') : maskTail(profile?.pan || '')}
                status={verifyStatus('pan')} onPress={() => openVerifyModal('pan')}
              />
              <VerifiableRow
                icon="finger-print" label="Aadhar No."
                value={showSensitive ? (profile?.aadhar || '—') : maskTail(profile?.aadhar || '')}
                status={verifyStatus('aadhar')} onPress={() => openVerifyModal('aadhar')} last
              />
            </View>
            <Text style={s.verifyHint}>Tap a field to request a change — HR or your manager will need to verify it before it's marked Verified.</Text>
            {teamPending !== null && (
              <TouchableOpacity style={s.teamVerifyBtn} onPress={() => router.push('/team-verification' as any)} activeOpacity={0.85}>
                <Ionicons name="people-outline" size={18} color={C.primary} />
                <Text style={s.teamVerifyText}>Team Verification Requests</Text>
                {teamPending > 0 && <View style={s.teamVerifyBadge}><Text style={s.teamVerifyBadgeText}>{teamPending}</Text></View>}
                <Ionicons name="chevron-forward" size={16} color={C.muted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Work Info */}
          <View style={s.section}>
            <View style={s.sectionTitleRow}>
              <View style={[s.sectionTitleDot, { backgroundColor: C.success }]} />
              <Text style={s.sectionTitle}>Work Info</Text>
            </View>
            <View style={s.card}>
              <InfoRow icon="business-outline" label="Company" value={upper(tenant?.company_name) || '—'} />
              <InfoRow icon="briefcase-outline" label="Department" value={upper(profile?.department) || '—'} />
              <InfoRow icon="ribbon-outline" label="Designation" value={upper(profile?.designation) || '—'} />
              <InfoRow icon="person-circle-outline" label="Reporting Manager" value={managerName || 'Not assigned'} />
              <InfoRow icon="people-circle-outline" label="HOD" value={hodName || 'Not assigned'} />
              <InfoRow icon="people-outline" label="Role" value={roleLabel(profile?.role || '')} />
              <InfoRow icon="checkmark-circle-outline" label="Status" value={profile?.status || '—'} />
              <InfoRow icon="time-outline" label="Shift Hours" value={shiftLabel()} />
              <InfoRow icon="hourglass-outline" label="Probation Period" value={!probation ? '—' : probation.completed ? 'Completed' : `Completes on ${fmtDate(probation.endsOn)}`} />
              <InfoRow icon="calendar-outline" label="Weekly Holiday" value={weeklyOffLabel || '—'} last={!profile?.comp_off_balance || profile.comp_off_balance <= 0} />
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

      {/* Verification edit modal — Bank/PAN/Aadhar changes route through a
          verification request instead of writing straight to the profile. */}
      <Modal visible={!!verifyModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={vm.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={vm.card}>
            <View style={vm.handle} />
            <View style={vm.header}>
              <Text style={vm.title}>Update {verifyModal ? FIELD_GROUP_LABEL[verifyModal] : ''}</Text>
              <TouchableOpacity onPress={() => setVerifyModal(null)} style={vm.closeBtn}>
                <Ionicons name="close" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>
            <Text style={vm.notice}>
              This change won't take effect until HR or your reporting manager reviews and approves it.
            </Text>

            {verifyModal === 'bank' && (
              <>
                <TextInput style={vm.input} placeholder="Bank Account Number" placeholderTextColor={C.muted}
                  keyboardType="numeric" maxLength={18} value={verifyForm.bank_acc}
                  onChangeText={(v) => setVerifyForm((f) => ({ ...f, bank_acc: v.replace(/\D/g, '') }))} />
                <TextInput style={vm.input} placeholder="Bank Name" placeholderTextColor={C.muted}
                  value={verifyForm.bank_name} onChangeText={(v) => setVerifyForm((f) => ({ ...f, bank_name: v }))} />
                <TextInput style={vm.input} placeholder="IFSC Code" placeholderTextColor={C.muted}
                  autoCapitalize="characters" maxLength={11} value={verifyForm.ifsc_code}
                  onChangeText={(v) => setVerifyForm((f) => ({ ...f, ifsc_code: v }))} />
              </>
            )}
            {verifyModal === 'pan' && (
              <TextInput style={vm.input} placeholder="PAN Number" placeholderTextColor={C.muted}
                autoCapitalize="characters" maxLength={10} value={verifyForm.pan}
                onChangeText={(v) => setVerifyForm((f) => ({ ...f, pan: v }))} />
            )}
            {verifyModal === 'aadhar' && (
              <TextInput style={vm.input} placeholder="Aadhar Number" placeholderTextColor={C.muted}
                keyboardType="numeric" maxLength={12} value={verifyForm.aadhar}
                onChangeText={(v) => setVerifyForm((f) => ({ ...f, aadhar: v.replace(/\D/g, '') }))} />
            )}

            <View style={vm.footer}>
              <TouchableOpacity style={vm.cancelBtn} onPress={() => setVerifyModal(null)}>
                <Text style={vm.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[vm.submitBtn, savingVerify && { opacity: 0.6 }]} onPress={submitVerifyEdit} disabled={savingVerify}>
                {savingVerify ? <ActivityIndicator color="#fff" size="small" /> : <Text style={vm.submitText}>Submit for Verification</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const vm = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  card: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '800', color: C.text },
  closeBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  notice: { fontSize: 12, color: C.muted, lineHeight: 17, marginBottom: 16 },
  input: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: C.text,
    backgroundColor: '#FAFAFA', marginBottom: 12,
  },
  footer: { flexDirection: 'row', gap: 12, marginTop: 8, paddingBottom: 12 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: C.muted },
  submitBtn: { flex: 1, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  submitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});

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
  heroEmpCode: { fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.8)', letterSpacing: 0.6, marginTop: -4, marginBottom: 8 },
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
  verifyHint: { fontSize: 11, color: C.muted, marginTop: 8, paddingHorizontal: 4, lineHeight: 15 },
  teamVerifyBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, backgroundColor: C.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: C.primaryBg },
  teamVerifyText: { flex: 1, fontSize: 13.5, fontWeight: '700', color: C.text },
  teamVerifyBadge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  teamVerifyBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },

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
