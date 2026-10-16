import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Animated, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useForegroundRefresh } from '@/hooks/useForegroundRefresh';
import { listMyLeaveRequests, requestLeave, checkProbationStatus, fetchMyHalfDayWindows } from '@/services/leaveService';
import { fetchMyQuota } from '@/services/requestQuotaService';
import { fetchMyLeaveBalances, fetchMyLeaveLedger, listLeaveTypes } from '@/services/leaveLedgerService';
import { fetchMyCompOffBalance } from '@/services/compOffService';
import { showToast } from '@/components/Toast';
import PageHeader from '@/components/PageHeader';
import LeaveBalanceCard, { pickEarnedBalance } from '@/components/LeaveBalanceCard';
import { LeaveTracker } from '@/components/LeaveTracker';
import { fmtDate, todayStr, HIGH_SALARY_THRESHOLD, isRaniwalaTenant } from '@/lib/helpers';
import {
  HALF_DAY_OPTIONS, halfDayLabel, requestHalfDayLabel, clock12, type HalfDay, type HalfDayWindows,
} from '@/lib/halfDayLeave';
import { Colors as C } from '@/constants/Colors';

type LeaveBalance = {
  leave_type_id: string;
  allocated: number;
  used: number;
  balance: number;
  leave_type?: {
    name: string; is_unlimited: boolean; is_paid?: boolean; encashable?: boolean;
    annual_quota?: number; accrual_frequency?: string; accrual_days?: number;
    carry_forward?: boolean; max_carry_forward_days?: number; max_continuous_days?: number | null;
  };
};

function LeaveBalanceRow({ balances }: { balances: LeaveBalance[] }) {
  if (!balances.length) return null;
  return (
    <View style={lb.wrap}>
      {balances.map((b) => {
        const lt = b.leave_type;
        const accrual = !lt?.accrual_frequency || lt.accrual_frequency === 'none'
          ? null
          : `+${lt.accrual_days} days/${lt.accrual_frequency === 'monthly' ? 'month' : 'year'}`;
        const bal = Number(b.balance);
        return (
          <View key={b.leave_type_id} style={lb.item}>
            <Text style={[lb.count, bal < 0 && { color: C.danger }]}>{lt?.is_unlimited ? '∞' : bal}</Text>
            {!lt?.is_unlimited && <Text style={lb.unit}>{Math.abs(bal) === 1 ? 'day' : 'days'} left</Text>}
            <Text style={lb.label} numberOfLines={1}>{lt?.name || 'Leave'}</Text>
            {!lt?.is_unlimited && (
              <View style={lb.factsRow}>
                {!!accrual && <Text style={lb.fact}>{accrual}</Text>}
                {!accrual && !!lt?.annual_quota && <Text style={lb.fact}>{lt.annual_quota} days/year</Text>}
                {lt?.carry_forward && <Text style={lb.fact}>Carry forward up to {lt.max_carry_forward_days} days</Text>}
              </View>
            )}
            <View style={lb.badgeRow}>
              <Text style={[lb.badge, { color: lt?.is_paid ? C.success : C.muted, backgroundColor: lt?.is_paid ? C.successBg : C.bg }]}>
                {lt?.is_paid ? 'Paid' : 'Unpaid'}
              </Text>
              {lt?.encashable && <Text style={[lb.badge, { color: C.teal, backgroundColor: C.tealBg }]}>Encashable</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const lb = StyleSheet.create({
  wrap: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    marginHorizontal: 16, marginBottom: 10,
  },
  item: {
    flexGrow: 1, minWidth: 130, alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 8,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  count: { fontSize: 18, fontWeight: '800', color: C.primary },
  unit: { fontSize: 9.5, color: C.muted, fontWeight: '600' },
  label: { fontSize: 10.5, color: C.muted, marginTop: 2, textAlign: 'center', paddingHorizontal: 4 },
  factsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 6 },
  fact: { fontSize: 9.5, color: C.muted, fontWeight: '600' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4, marginTop: 6 },
  badge: { fontSize: 9, fontWeight: '700', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
});

// Small pill for a Raniwala dual-approval row's manager/HR sub-status —
// mirrors stagePill from src/pages/dashboard/LeavesPage.jsx.
function stagePill(label: string, value: string | null | undefined) {
  if (!value || value === 'Not Required') return null;
  const sty = value === 'Approved' ? { bg: C.successBg, color: C.success }
    : value === 'Rejected' ? { bg: C.dangerBg, color: C.danger }
    : { bg: C.warningBg, color: C.warning };
  return (
    <View key={label} style={[stg.pill, { backgroundColor: sty.bg }]}>
      <Text style={[stg.text, { color: sty.color }]}>{label}: {value}</Text>
    </View>
  );
}

const stg = StyleSheet.create({
  pill: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, marginRight: 6, marginTop: 4 },
  text: { fontSize: 9.5, fontWeight: '700' },
});

type Quota = { selfUsed: number; selfLimit: number; managerUsed: number; managerLimit: number };

function QuotaBanner({ quota }: { quota: Quota }) {
  const selfLeft = quota.selfLimit - quota.selfUsed;
  const managerLeft = quota.managerLimit - quota.managerUsed;
  let bg: string, border: string, icon: keyof typeof Ionicons.glyphMap, msg: string, iconColor: string;
  if (selfLeft > 0) {
    bg = C.successBg; border = C.success; icon = 'shield-checkmark'; iconColor = C.success;
    msg = `${selfLeft} self-approval${selfLeft !== 1 ? 's' : ''} left — next request auto-approves instantly.`;
  } else if (managerLeft > 0) {
    bg = C.warningBg; border = C.warning; icon = 'person-circle'; iconColor = C.warning;
    msg = `Self-approvals used. Next request goes to Manager (${managerLeft} left).`;
  } else {
    bg = C.dangerBg; border = C.danger; icon = 'alert-circle'; iconColor = C.danger;
    msg = 'All quotas used this month. Next request goes to HR.';
  }
  return (
    <View style={[bs.banner, { backgroundColor: bg, borderLeftColor: border }]}>
      <Ionicons name={icon} size={16} color={iconColor} />
      <Text style={[bs.text, { color: border }]}>{msg}</Text>
    </View>
  );
}

const bs = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderLeftWidth: 3, borderRadius: 12, padding: 12,
    marginHorizontal: 16, marginBottom: 10,
  },
  text: { flex: 1, fontSize: 12.5, fontWeight: '500', lineHeight: 18 },
});

const LEAVE_COLORS: Record<string, { color: string; bg: string }> = {
  'Casual Leave': { color: C.primary, bg: C.primaryBg },
  'Sick Leave': { color: C.danger, bg: C.dangerBg },
  'Paid Leave': { color: C.success, bg: C.successBg },
  'Maternity/Paternity Leave': { color: '#8B5CF6', bg: '#EDE9FE' },
  'Loss of Pay': { color: C.warning, bg: C.warningBg },
  'Comp Off': { color: C.teal, bg: C.tealBg },
  'Earned (Probation)': { color: '#F97316', bg: '#FFEDD5' },
  'Earned Leave': { color: C.primary, bg: C.primaryBg },
  'Unpaid Leave': { color: C.warning, bg: C.warningBg },
};

// Loss of Pay, no balance. Offered wherever the tenant has it as an active
// leave type; the DB routes it to Manager, HOD and HR (web repo migration
// 20261010_3_raniwala_unpaid_leave.sql).
const UNPAID_LEAVE_TYPE = 'Unpaid Leave';

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Approved: { bg: C.successBg, color: C.success },
  Rejected: { bg: C.dangerBg, color: C.danger },
  Pending: { bg: C.warningBg, color: C.warning },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const EMPTY_FORM = {
  leave_type: '',
  start_date: todayStr(),
  end_date: todayStr(),
  // '' = full day(s); 'first_half' / 'second_half' = half of one date (Raniwala).
  half_day: '' as HalfDay,
  reason: '',
};

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={s.formGroup}>
      <Text style={s.formLabel}>{label}</Text>
      <View style={s.inputWrap}>
        <Ionicons name="calendar-outline" size={15} color={C.primary} style={{ marginLeft: 12 }} />
        <TextInput
          style={s.input}
          value={value}
          onChangeText={onChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={C.muted}
          keyboardType="numeric"
          maxLength={10}
        />
      </View>
    </View>
  );
}

export default function LeavesScreen() {
  const { profile, tenant } = useAuth();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [probation, setProbation] = useState<{ inProbation: boolean; endsOn: string | null; earnedLeaves: number } | null>(null);
  const [activeLeaveTypes, setActiveLeaveTypes] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [freshCompOff, setFreshCompOff] = useState<number | null>(null);
  // The employee's shift split in two, for the half-day choice.
  const [halfWindows, setHalfWindows] = useState<HalfDayWindows | null>(null);
  const activeLeaveTypeNames = activeLeaveTypes.map((t) => t.name);

  const raniwala = isRaniwalaTenant(tenant);
  // Mirrors src/pages/employee/MyLeavesPage.jsx's compOffEligible exactly —
  // Raniwala makes every employee comp-off eligible regardless of CTC, since
  // factory/lower-paid staff earn it just by punching in on their weekly off.
  const compOffEligible = raniwala || (profile?.ctc || 0) >= HIGH_SALARY_THRESHOLD;
  const compOffBalance = freshCompOff ?? Number(profile?.comp_off_balance || 0);
  const hasCompOff = compOffEligible && compOffBalance > 0;
  const earned = pickEarnedBalance(balances);
  const earnedTypeName = balances.find((b) => /earned/i.test(b.leave_type?.name || ''))?.leave_type?.name
    || activeLeaveTypeNames.find((n) => /earned/i.test(n)) || 'Earned Leave';
  // Raniwala: employees pick Earned Leave, Unpaid Leave or Comp Off. Marriage /
  // bereavement etc. are requested as Earned Leave with the occasion in the
  // reason, and HR credits extra days to the balance when granting it.
  const unpaidOffered = activeLeaveTypeNames.includes(UNPAID_LEAVE_TYPE);
  const leaveTypes = probation?.inProbation
    ? ['Earned (Probation)']
    : raniwala
      ? [earnedTypeName, ...(unpaidOffered ? [UNPAID_LEAVE_TYPE] : []), 'Comp Off']
      : [...activeLeaveTypeNames, ...(hasCompOff ? ['Comp Off'] : [])];
  const typeBalance = (t: string): number | null =>
    t === 'Comp Off' ? compOffBalance : raniwala && t === earnedTypeName ? earned.balance : null;

  const fetchRequests = useCallback(async () => {
    if (!profile) return;
    const [reqRes, probRes, quotaRes, balRes, typesRes, ledgerRes, compOffRes] = await Promise.all([
      listMyLeaveRequests(profile.id),
      checkProbationStatus(profile.id),
      tenant ? fetchMyQuota(tenant.id, profile.id) : null,
      fetchMyLeaveBalances(profile.id),
      tenant ? listLeaveTypes(tenant.id) : null,
      raniwala ? null : fetchMyLeaveLedger(profile.id),
      fetchMyCompOffBalance(profile.id),
    ]);
    if (reqRes.error) showToast(reqRes.error.message, 'error');
    else setRequests(reqRes.data);
    setProbation(probRes);
    if (quotaRes) setQuota(quotaRes);
    if (!balRes.error) setBalances(balRes.data as LeaveBalance[]);
    if (typesRes && !typesRes.error) {
      setActiveLeaveTypes(typesRes.data.filter((t: any) => t.is_active));
    }
    if (ledgerRes && !ledgerRes.error) setLedger(ledgerRes.data);
    if (compOffRes.balance != null) setFreshCompOff(compOffRes.balance);
  }, [profile, tenant, raniwala]);

  // Default the request form to the tenant's first active leave type, once
  // known — the hardcoded 'Casual Leave' placeholder doesn't exist for every
  // tenant (e.g. Raniwala only has Earned/Marriage/Bereavement Leave).
  useEffect(() => {
    if (!form.leave_type && leaveTypes.length > 0) {
      setForm((f) => ({ ...f, leave_type: leaveTypes[0] }));
    }
  }, [leaveTypes, form.leave_type]);

  useForegroundRefresh(fetchRequests, setLoading);

  useEffect(() => {
    if (!showModal || !raniwala || halfWindows) return;
    fetchMyHalfDayWindows().then(({ data }) => setHalfWindows(data));
  }, [showModal, raniwala, halfWindows]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchRequests();
    setRefreshing(false);
  }, [fetchRequests]);

  const handleSubmit = async () => {
    if (!form.reason.trim()) { showToast('Please provide a reason.', 'error'); return; }
    // A half day is one date; the DB stamps its times from the shift.
    const endDate = form.half_day ? form.start_date : form.end_date;
    if (!form.start_date || !endDate) { showToast('Please select both dates.', 'error'); return; }
    if (!DATE_RE.test(form.start_date) || !DATE_RE.test(endDate)) {
      showToast('Dates must be in YYYY-MM-DD format.', 'error'); return;
    }
    if (isNaN(new Date(form.start_date).getTime()) || isNaN(new Date(endDate).getTime())) {
      showToast('Please enter valid calendar dates.', 'error'); return;
    }
    if (endDate < form.start_date) { showToast('End date cannot be before start date.', 'error'); return; }
    if (!tenant) { showToast('You do not belong to any workspace.', 'error'); return; }
    // The type fills in once leave types load — a request without one can never be deducted.
    if (!form.leave_type) { showToast('Please choose a leave type.', 'error'); return; }
    if (probation?.inProbation && form.leave_type !== 'Earned (Probation)') {
      showToast(`You are in probation until ${fmtDate(probation.endsOn)}. Only earned probation leaves can be used.`, 'error');
      return;
    }
    if (probation?.inProbation && form.leave_type === 'Earned (Probation)' && (probation.earnedLeaves || 0) <= 0) {
      showToast('You have no earned probation leaves yet. Work all days in a month to earn one.', 'error');
      return;
    }
    // Same rule as the website: only Comp Off is capped by its balance.
    if (form.leave_type === 'Comp Off') {
      const need = form.half_day ? 0.5 : daysBetween(form.start_date, endDate);
      if (need > compOffBalance) {
        showToast(`You have ${compOffBalance} comp off day${compOffBalance === 1 ? '' : 's'} — this request needs ${need}.`, 'error');
        return;
      }
    }
    setSaving(true);
    try {
      // half_day only goes out when a half is picked, so a full-day leave
      // never depends on that column.
      const { half_day, ...rest } = form;
      const payload = {
        ...rest, end_date: endDate, ...(half_day ? { half_day } : {}),
        profile_id: profile!.id, tenant_id: tenant.id, status: 'Pending',
      };
      const { error, tier } = await requestLeave(payload);
      if (error) {
        showToast(error.message || 'Failed to submit leave request.', 'error');
      } else {
        const msg = raniwala && form.leave_type === UNPAID_LEAVE_TYPE
          ? 'Sent for Manager, HOD and HR approval.'
          : raniwala
          ? 'Leave request sent for approval.'
          : tier === 'self' ? 'Auto-approved!' : tier === 'manager' ? 'Sent to Manager for approval.' : 'Submitted for HR approval.';
        showToast(msg, tier === 'self' ? 'success' : 'info');
        setShowModal(false);
        setForm({ ...EMPTY_FORM });
        fetchRequests();
      }
    } catch (err: any) {
      showToast(err.message || 'Something went wrong.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const daysBetween = (start: string, end: string) => {
    const s = new Date(start), e = new Date(end);
    return Math.ceil(Math.abs(e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <PageHeader
        title="My Leaves"
        subtitle='Requests & history'
        right={(
          <>
          <TouchableOpacity style={s.addBtn} onPress={() => setShowModal(true)} activeOpacity={0.85}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={s.addBtnText}>Request</Text>
          </TouchableOpacity>
          </>
        )}
      />

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}>
        <View style={{ height: 12 }} />
        {/* Banners */}
        {probation?.inProbation && (
          <View style={[s.infoBanner, { borderLeftColor: C.warning, backgroundColor: C.warningBg }]}>
            <Ionicons name="hourglass-outline" size={15} color={C.warning} />
            <Text style={[s.infoBannerText, { color: '#92400E' }]}>
              <Text style={{ fontWeight: '700' }}>Probation</Text> ends {fmtDate(probation.endsOn)}. Regular leaves are blocked. {' '}
              You have <Text style={{ fontWeight: '700' }}>{probation.earnedLeaves}</Text> earned leave{probation.earnedLeaves !== 1 ? 's' : ''} available.
            </Text>
          </View>
        )}
        {hasCompOff && !probation?.inProbation && !raniwala && (
          <View style={[s.infoBanner, { borderLeftColor: C.primary, backgroundColor: C.primaryBg }]}>
            <Ionicons name="gift-outline" size={15} color={C.primary} />
            <Text style={[s.infoBannerText, { color: C.primary }]}>
              You have <Text style={{ fontWeight: '700' }}>{profile?.comp_off_balance}</Text> Comp Off{(profile?.comp_off_balance || 0) > 1 ? 's' : ''} available.
            </Text>
          </View>
        )}
        {/* Raniwala leave requests route to the reporting manager (then HR for
            >3 days), never auto-approve — this quota banner would be
            misleading there. */}
        {quota && !raniwala && <QuotaBanner quota={quota} />}
        {raniwala && !probation?.inProbation
          ? <LeaveBalanceCard earned={earned} compOff={compOffBalance} />
          : <LeaveBalanceRow balances={balances} />}
        {/* Raniwala: just the Earned Leave + Comp Off balances (Leave Wallet
            above) — no monthly summary or ledger statement. */}
        {!probation?.inProbation && !raniwala && (
          <LeaveTracker
            leaveTypes={activeLeaveTypes}
            ledger={ledger}
            requests={requests}
            compOffBalance={compOffEligible ? compOffBalance : null}
          />
        )}
        {requests.length > 0 && <Text style={s.sectionTitle}>My Requests</Text>}
        {loading ? (
          <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>
        ) : requests.length === 0 ? (
          <View style={s.emptyCard}>
            <View style={s.emptyIconWrap}>
              <Ionicons name="calendar-outline" size={36} color={C.primary} />
            </View>
            <Text style={s.emptyTitle}>No leave requests yet</Text>
            <Text style={s.emptyText}>Tap "Request" above to apply for leave.</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={() => setShowModal(true)}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={s.emptyBtnText}>New Request</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.list}>
            {requests.map((req) => {
              const ss = STATUS_STYLE[req.status] || STATUS_STYLE['Pending'];
              const lt = LEAVE_COLORS[req.leave_type] || { color: C.primary, bg: C.primaryBg };
              const days = daysBetween(req.start_date, req.end_date);
              const half = requestHalfDayLabel(req);
              return (
                <View key={req.id} style={s.leaveCard}>
                  <View style={[s.leaveStripe, { backgroundColor: lt.color }]} />
                  <View style={s.leaveContent}>
                    <View style={s.leaveTop}>
                      <View style={[s.typePill, { backgroundColor: lt.bg }]}>
                        <Text style={[s.typePillText, { color: lt.color }]}>{req.leave_type}</Text>
                      </View>
                      <View style={[s.statusPill, { backgroundColor: ss.bg }]}>
                        <View style={[s.statusDot, { backgroundColor: ss.color }]} />
                        <Text style={[s.statusText, { color: ss.color }]}>{req.status}</Text>
                      </View>
                    </View>
                    <View style={s.datesRow}>
                      <Ionicons name="calendar-outline" size={13} color={C.muted} />
                      <Text style={s.datesText}>
                        {half ? fmtDate(req.start_date) : `${fmtDate(req.start_date)} — ${fmtDate(req.end_date)}`}
                      </Text>
                      <View style={s.daysBadge}>
                        <Text style={s.daysText}>{half ? '½d' : `${days}d`}</Text>
                      </View>
                    </View>
                    {!!half && <Text style={s.halfText}>{half}</Text>}
                    {raniwala && req.manager_status != null && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {stagePill('Manager', req.manager_status)}
                        {stagePill('HOD', req.hod_status)}
                        {stagePill('HR', req.hr_status)}
                        {stagePill('Management', req.management_status)}
                      </View>
                    )}
                    {!!req.reason && <Text style={s.reasonText} numberOfLines={2}>{req.reason}</Text>}
                    <Text style={s.appliedAt}>Applied {fmtDate(req.created_at)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Request Leave Modal */}
      <Modal visible={showModal && !showTypePicker} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <View style={s.modalTitleRow}>
                <View style={s.modalIconWrap}>
                  <Ionicons name="calendar-outline" size={18} color={C.primary} />
                </View>
                <Text style={s.modalTitle}>Request Leave</Text>
              </View>
              <TouchableOpacity onPress={() => setShowModal(false)} style={s.closeBtn}>
                <Ionicons name="close" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Leave Type</Text>
                <TouchableOpacity style={s.select} onPress={() => setShowTypePicker(true)} activeOpacity={0.8}>
                  <View style={[s.selectDot, { backgroundColor: (LEAVE_COLORS[form.leave_type] || { color: C.primary }).color }]} />
                  <Text style={s.selectText}>{form.leave_type}</Text>
                  {typeBalance(form.leave_type) != null && (
                    <Text style={s.selectBal}>{typeBalance(form.leave_type)} left</Text>
                  )}
                  <Ionicons name="chevron-down" size={16} color={C.muted} />
                </TouchableOpacity>
                {form.leave_type === UNPAID_LEAVE_TYPE && (
                  <Text style={s.formHint}>
                    Unpaid leave is Loss of Pay — these days are not paid and your Earned Leave balance is not touched.
                    It needs approval from your Manager, HOD and HR.
                  </Text>
                )}
              </View>

              {raniwala && !probation?.inProbation && (
                <View style={s.formGroup}>
                  <Text style={s.formLabel}>Duration</Text>
                  <View style={s.chipRow}>
                    {HALF_DAY_OPTIONS.map((o) => {
                      const active = form.half_day === o.value;
                      const w = o.value ? halfWindows?.[o.value] : null;
                      return (
                        <TouchableOpacity
                          key={o.value || 'full'}
                          style={[s.chip, active && s.chipActive]}
                          onPress={() => setForm((f) => ({ ...f, half_day: o.value }))}
                          activeOpacity={0.8}
                        >
                          <Text style={[s.chipText, active && s.chipTextActive]}>{o.label}</Text>
                          {!!w && (
                            <Text style={[s.chipTime, active && s.chipTextActive]}>{clock12(w.from)} – {clock12(w.to)}</Text>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {!!form.half_day && (
                    <Text style={s.formHint}>
                      Half a day of leave (0.5 day).
                      {halfWindows?.shift_start
                        ? ` Your shift: ${clock12(halfWindows.shift_start)} – ${clock12(halfWindows.shift_end)}${halfWindows.shift_name ? ` (${halfWindows.shift_name})` : ''}.`
                        : ''}
                      {' '}Work the other half as usual.
                    </Text>
                  )}
                </View>
              )}

              {form.half_day ? (
                <DateInput label="Date" value={form.start_date} onChange={(v) => setForm((f) => ({ ...f, start_date: v, end_date: v }))} />
              ) : (
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <DateInput label="Start Date" value={form.start_date} onChange={(v) => setForm((f) => ({ ...f, start_date: v }))} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <DateInput label="End Date" value={form.end_date} onChange={(v) => setForm((f) => ({ ...f, end_date: v }))} />
                  </View>
                </View>
              )}

              <View style={s.formGroup}>
                <Text style={s.formLabel}>Reason</Text>
                <TextInput
                  style={[s.inputRaw, s.textarea]}
                  value={form.reason}
                  onChangeText={(v) => setForm((f) => ({ ...f, reason: v }))}
                  placeholder={raniwala ? 'Brief reason — mention here if it is for marriage or another special occasion…' : 'Please provide a brief reason…'}
                  placeholderTextColor={C.muted}
                  multiline
                  numberOfLines={3}
                />
              </View>

              <View style={s.modalFooter}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setShowModal(false)}>
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.submitBtn, saving && { opacity: 0.6 }]} onPress={handleSubmit} disabled={saving} activeOpacity={0.85}>
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.submitText}>Submit Request</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Type picker */}
      <Modal visible={showTypePicker} animationType="fade" transparent>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowTypePicker(false)}>
          <TouchableOpacity activeOpacity={1} style={s.pickerCard} onPress={() => {}}>
            <Text style={s.pickerTitle}>Select Leave Type</Text>
            {leaveTypes.map((t) => {
              const lt = LEAVE_COLORS[t] || { color: C.primary, bg: C.primaryBg };
              return (
                <TouchableOpacity
                  key={t}
                  style={[s.pickerItem, form.leave_type === t && { backgroundColor: lt.bg }]}
                  onPress={() => { setForm((f) => ({ ...f, leave_type: t })); setShowTypePicker(false); }}
                >
                  <View style={[s.pickerDot, { backgroundColor: lt.color }]} />
                  <Text style={[s.pickerText, form.leave_type === t && { color: lt.color, fontWeight: '700' }]}>{t}</Text>
                  {typeBalance(t) != null && <Text style={s.pickerBal}>{typeBalance(t)} left</Text>}
                  {t === UNPAID_LEAVE_TYPE && <Text style={s.pickerBal}>Loss of Pay</Text>}
                  {form.leave_type === t && <Ionicons name="checkmark-circle" size={18} color={lt.color} />}
                </TouchableOpacity>
              );
            })}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.surface },
  scroll: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16, backgroundColor: C.dark,
  },
  title: { fontSize: 24, fontWeight: '900', color: '#fff' },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
  },
  addBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  infoBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderLeftWidth: 3, borderRadius: 12, padding: 12,
    marginHorizontal: 14, marginBottom: 8,
  },
  infoBannerText: { flex: 1, fontSize: 12.5, lineHeight: 18 },
  loadingBox: { padding: 60, alignItems: 'center' },
  emptyCard: {
    margin: 16, backgroundColor: C.surface, borderRadius: 20,
    padding: 40, alignItems: 'center', gap: 10,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  emptyIconWrap: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  emptyText: { fontSize: 13, color: C.muted, textAlign: 'center' },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 8, backgroundColor: C.primary, borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 11,
  },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  list: { padding: 14, gap: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: C.text, marginHorizontal: 18, marginTop: 8 },
  leaveCard: {
    flexDirection: 'row', backgroundColor: C.surface, borderRadius: 18, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  leaveStripe: { width: 5 },
  leaveContent: { flex: 1, padding: 14, gap: 8 },
  leaveTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  typePill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  typePillText: { fontSize: 12, fontWeight: '700' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11.5, fontWeight: '700' },
  datesRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  datesText: { fontSize: 13, color: C.text, flex: 1 },
  daysBadge: {
    backgroundColor: C.bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: C.border,
  },
  daysText: { fontSize: 11, color: C.muted, fontWeight: '700' },
  halfText: { fontSize: 12, color: C.primary, fontWeight: '600' },
  reasonText: { fontSize: 12.5, color: C.muted, lineHeight: 18 },
  appliedAt: { fontSize: 11, color: '#CBD5E1' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, maxHeight: '88%',
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: C.border,
    alignSelf: 'center', marginBottom: 16,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalIconWrap: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: C.text },
  closeBtn: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: C.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  formGroup: { marginBottom: 16 },
  formLabel: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 7 },
  formHint: { fontSize: 12, color: C.muted, lineHeight: 17, marginTop: 7 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: C.border, borderRadius: 14,
    backgroundColor: '#FAFAFA',
  },
  input: { flex: 1, paddingVertical: 12, paddingHorizontal: 12, fontSize: 14, color: C.text },
  inputRaw: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: C.text,
    backgroundColor: '#FAFAFA',
  },
  textarea: { height: 88, textAlignVertical: 'top' },
  select: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1.5, borderColor: C.border, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 13, backgroundColor: '#FAFAFA',
  },
  selectDot: { width: 10, height: 10, borderRadius: 5 },
  selectText: { flex: 1, fontSize: 14, color: C.text, fontWeight: '500' },
  selectBal: { fontSize: 12, fontWeight: '700', color: C.primary },
  row: { flexDirection: 'row', gap: 12, marginBottom: 0 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 12,
    paddingVertical: 9, paddingHorizontal: 6, alignItems: 'center', backgroundColor: '#FAFAFA',
  },
  chipActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  chipText: { fontSize: 12.5, fontWeight: '700', color: C.text },
  chipTime: { fontSize: 10, color: C.muted, marginTop: 2 },
  chipTextActive: { color: C.primary },
  modalFooter: { flexDirection: 'row', gap: 12, marginTop: 8, paddingBottom: 12 },
  cancelBtn: {
    flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center',
  },
  cancelText: { fontSize: 14, fontWeight: '600', color: C.muted },
  submitBtn: {
    flex: 1, backgroundColor: C.primary, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center',
    shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 10, elevation: 5,
  },
  submitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  pickerCard: {
    alignSelf: 'center', backgroundColor: C.surface, borderRadius: 24,
    padding: 20, width: '85%', maxWidth: 340,
    marginTop: 'auto', marginBottom: 'auto',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 24, elevation: 12,
  },
  pickerTitle: { fontSize: 16, fontWeight: '800', color: C.text, marginBottom: 14 },
  pickerItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 10, borderRadius: 12,
  },
  pickerDot: { width: 10, height: 10, borderRadius: 5 },
  pickerText: { flex: 1, fontSize: 14, color: C.text },
  pickerBal: { fontSize: 12, fontWeight: '700', color: C.muted },
});
