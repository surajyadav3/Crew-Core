import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Animated, Easing, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useMyShift, type MyShift } from '@/hooks/useMyShift';
import { useFeatures } from '@/context/FeatureContext';
import { useForegroundRefresh } from '@/hooks/useForegroundRefresh';
import { listMySpecialRequests, submitSpecialRequest } from '@/services/specialRequestService';
import { submitRegularizeRequest, listMyRegularizeRequests } from '@/services/attendanceService';
import { fetchMyQuota } from '@/services/requestQuotaService';
import { showToast } from '@/components/Toast';
import RegularizeExtensionNotice from '@/components/RegularizeExtensionNotice';
import DayPicker from '@/components/DayPicker';
import PageHeader from '@/components/PageHeader';
import {
  todayStr, fmtDate, fmtTime12, fmt, regularizeMinDate, regularizeWindowLabel,
  HIGH_SALARY_THRESHOLD, calcPayableOvertimeHours, calcOtPay, isRaniwalaTenant,
} from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

type Quota = { selfUsed: number; selfLimit: number; managerUsed: number; managerLimit: number };

function QuotaBanner({ quota }: { quota: Quota }) {
  const selfLeft = quota.selfLimit - quota.selfUsed;
  const managerLeft = quota.managerLimit - quota.managerUsed;
  let bg: string, border: string, icon: keyof typeof Ionicons.glyphMap, msg: string;
  if (selfLeft > 0) {
    bg = C.successBg; border = C.success; icon = 'shield-checkmark';
    msg = `${selfLeft} self-approval${selfLeft !== 1 ? 's' : ''} left — next request auto-approves instantly.`;
  } else if (managerLeft > 0) {
    bg = C.warningBg; border = C.warning; icon = 'person-circle';
    msg = `Self-approvals used. Next request goes to Manager (${managerLeft} left).`;
  } else {
    bg = C.dangerBg; border = C.danger; icon = 'alert-circle';
    msg = 'All quotas used this month. Next request goes to HR.';
  }
  return (
    <View style={[qb.banner, { backgroundColor: bg, borderLeftColor: border }]}>
      <Ionicons name={icon} size={15} color={border} />
      <Text style={[qb.text, { color: border }]}>{msg}</Text>
    </View>
  );
}

const qb = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderLeftWidth: 3, borderRadius: 12, padding: 12,
    marginHorizontal: 14, marginTop: 12,
  },
  text: { flex: 1, fontSize: 12.5, fontWeight: '500', lineHeight: 18 },
});

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Approved: { bg: C.successBg, color: C.success },
  Rejected: { bg: C.dangerBg, color: C.danger },
  Pending: { bg: C.warningBg, color: C.warning },
};

const TYPE_COLORS: Record<string, { color: string; bg: string }> = {
  Overtime: { color: C.primary, bg: C.primaryBg },
  'Salary Overtime': { color: C.success, bg: C.successBg },
  'Late Arrival': { color: C.warning, bg: C.warningBg },
  Regularize: { color: C.purple, bg: '#EDE9FE' },
};

function calcShiftHours(shift: MyShift) {
  if (!shift.start || !shift.end) return 8;
  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  let from = sh * 60 + sm, to = eh * 60 + em;
  if (to <= from) to += 1440;
  return (to - from) / 60;
}

type SpecialType = 'Overtime' | 'Salary Overtime' | 'Late Arrival';

const EMPTY_SPECIAL = {
  request_type: 'Overtime' as SpecialType,
  request_date: todayStr(),
  reason: '',
  late_hours: '0-10 min',
  ot_hours: 0,
  ot_minutes: 45,
};

function SpecialTab({ onOpenModal, onRefresh }: { onOpenModal: (open: () => void) => void; onRefresh: (fn: () => Promise<void>) => void }) {
  const { profile, tenant } = useAuth();
  const myShift = useMyShift();
  const isOtEligible = (profile?.ctc || 0) > 0 && (profile?.ctc || 0) < HIGH_SALARY_THRESHOLD;
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_SPECIAL });
  const [saving, setSaving] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [showLateHoursPicker, setShowLateHoursPicker] = useState(false);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    const [reqRes, quotaRes] = await Promise.all([
      listMySpecialRequests(profile.id),
      tenant ? fetchMyQuota(tenant.id, profile.id) : null,
    ]);
    if (reqRes.error) showToast(reqRes.error.message || 'Could not load requests.', 'error');
    else setRequests(reqRes.data);
    if (quotaRes) setQuota(quotaRes);
  }, [profile, tenant]);

  useForegroundRefresh(fetchData, setLoading);

  useEffect(() => { onRefresh(fetchData); }, [fetchData]);

  const openModal = () => { setForm({ ...EMPTY_SPECIAL }); setShowModal(true); };
  useEffect(() => { onOpenModal(openModal); }, []);

  const handleSubmit = async () => {
    if (!form.reason.trim()) { showToast('Please provide a reason.', 'error'); return; }
    if (!tenant) { showToast('You do not belong to any workspace.', 'error'); return; }
    if (!DATE_RE.test(form.request_date) || isNaN(new Date(form.request_date).getTime())) {
      showToast('Please enter a valid date (YYYY-MM-DD).', 'error'); return;
    }
    if (form.request_type === 'Salary Overtime') {
      const totalMin = (form.ot_hours || 0) * 60 + (form.ot_minutes || 0);
      const payable = calcPayableOvertimeHours(totalMin);
      if (payable === 0) { showToast('Minimum 45 minutes of overtime is required.', 'error'); return; }
    }
    setSaving(true);
    try {
      const totalOtMin = form.request_type === 'Salary Overtime'
        ? (form.ot_hours || 0) * 60 + (form.ot_minutes || 0) : null;
      const payableHours = totalOtMin != null ? calcPayableOvertimeHours(totalOtMin) : null;
      const shiftHrs = calcShiftHours(myShift);
      const storedOtPay = form.request_type === 'Salary Overtime'
        ? calcOtPay(profile?.ctc || 0, shiftHrs, payableHours || 0) : null;
      const payload = {
        profile_id: profile!.id, tenant_id: tenant.id,
        request_type: form.request_type, request_date: form.request_date,
        reason: form.reason.trim(), status: 'Pending' as const,
        late_hours: form.request_type === 'Late Arrival' ? form.late_hours : null,
        overtime_hours: form.request_type === 'Salary Overtime' ? payableHours : null,
        overtime_minutes: form.request_type === 'Salary Overtime' ? totalOtMin : null,
        overtime_pay: storedOtPay,
      };
      const { error, tier } = await submitSpecialRequest(payload);
      if (error) {
        showToast(error.message || 'Failed to submit request.', 'error');
      } else {
        const msg = tier === 'self' ? 'Auto-approved!' : tier === 'manager' ? 'Sent to Manager.' : 'Escalated to HR.';
        showToast(msg, tier === 'self' ? 'success' : 'info');
        setShowModal(false); fetchData();
      }
    } catch (err: any) {
      showToast(err.message || 'Something went wrong.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const SPECIAL_TYPES = ['Overtime', ...(isOtEligible ? ['Salary Overtime'] : []), 'Late Arrival'];
  const LATE_HOUR_OPTIONS = ['0-10 min', '10-30 min', '30min-1hr', '1+ hour'];
  const shiftEndLabel = myShift.end ? fmtTime12(myShift.end) : null;
  const totalOtMin = (form.ot_hours || 0) * 60 + (form.ot_minutes || 0);
  const payableHours = calcPayableOvertimeHours(totalOtMin);
  const shiftHrs = calcShiftHours(myShift);
  const otPay = calcOtPay(profile?.ctc || 0, shiftHrs, payableHours);

  return (
    <>
      {quota && <QuotaBanner quota={quota} />}
      {loading ? (
        <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>
      ) : requests.length === 0 ? (
        <EmptyState icon="flash-outline" title="No requests yet" text="Submit overtime or late arrival requests here." onPress={openModal} />
      ) : (
        <View style={s.list}>
          {requests.map((req) => {
            const ss = STATUS_STYLE[req.status] || STATUS_STYLE['Pending'];
            const tc = TYPE_COLORS[req.request_type] || TYPE_COLORS['Overtime'];
            return (
              <View key={req.id} style={s.reqCard}>
                <View style={[s.reqStripe, { backgroundColor: tc.color }]} />
                <View style={s.reqContent}>
                  <View style={s.reqTop}>
                    <View style={[s.typePill, { backgroundColor: tc.bg }]}>
                      <Text style={[s.typePillText, { color: tc.color }]}>{req.request_type}</Text>
                    </View>
                    <View style={[s.statusPill, { backgroundColor: ss.bg }]}>
                      <View style={[s.statusDot, { backgroundColor: ss.color }]} />
                      <Text style={[s.statusText, { color: ss.color }]}>{req.status}</Text>
                    </View>
                  </View>
                  <View style={s.reqMeta}>
                    <Ionicons name="calendar-outline" size={12} color={C.muted} />
                    <Text style={s.reqMetaText}>{fmtDate(req.request_date)}</Text>
                    {req.request_type === 'Late Arrival' && req.late_hours && (
                      <Text style={s.reqMetaText}> · {req.late_hours}</Text>
                    )}
                    {req.request_type === 'Salary Overtime' && req.overtime_minutes != null && (
                      <Text style={s.reqMetaText}> · {Math.floor(req.overtime_minutes / 60)}h {req.overtime_minutes % 60}m</Text>
                    )}
                  </View>
                  {req.request_type === 'Salary Overtime' && req.status === 'Approved' && req.overtime_hours != null && (
                    <Text style={[s.otPayText, { color: C.success }]}>
                      {req.overtime_hours}h payable · {fmt(req.overtime_pay || 0)}
                    </Text>
                  )}
                  {!!req.reason && <Text style={s.reasonText} numberOfLines={2}>{req.reason}</Text>}
                  <Text style={s.appliedAt}>Applied {fmtDate(req.created_at)}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <Modal visible={showModal && !showTypePicker && !showLateHoursPicker} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <View style={s.modalTitleRow}>
                <View style={s.modalIconWrap}><Ionicons name="flash-outline" size={16} color={C.primary} /></View>
                <Text style={s.modalTitle}>New Special Request</Text>
              </View>
              <TouchableOpacity onPress={() => setShowModal(false)} style={s.closeBtn}>
                <Ionicons name="close" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Request Type</Text>
                <TouchableOpacity style={s.select} onPress={() => setShowTypePicker(true)} activeOpacity={0.8}>
                  <View style={[s.selectDot, { backgroundColor: (TYPE_COLORS[form.request_type] || TYPE_COLORS['Overtime']).color }]} />
                  <Text style={s.selectText}>{form.request_type}</Text>
                  <Ionicons name="chevron-down" size={16} color={C.muted} />
                </TouchableOpacity>
              </View>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Date</Text>
                <TextInput
                  style={s.input} value={form.request_date}
                  onChangeText={(v) => setForm((f) => ({ ...f, request_date: v }))}
                  placeholder="YYYY-MM-DD" placeholderTextColor={C.muted}
                  keyboardType="numeric" maxLength={10}
                />
              </View>
              {form.request_type === 'Salary Overtime' && (
                <>
                  {shiftEndLabel && (
                    <View style={s.infoBanner}>
                      <Ionicons name="information-circle-outline" size={14} color={C.primary} />
                      <Text style={s.infoText}>OT starts after shift ends at {shiftEndLabel}. Enter only post-shift hours.</Text>
                    </View>
                  )}
                  <View style={s.row}>
                    <View style={[s.formGroup, { flex: 1 }]}>
                      <Text style={s.formLabel}>OT Hours</Text>
                      <View style={s.stepper}>
                        <TouchableOpacity onPress={() => setForm((f) => ({ ...f, ot_hours: Math.max(0, f.ot_hours - 1) }))} style={s.stepBtn}>
                          <Ionicons name="remove" size={16} color={C.primary} />
                        </TouchableOpacity>
                        <Text style={s.stepVal}>{form.ot_hours}h</Text>
                        <TouchableOpacity onPress={() => setForm((f) => ({ ...f, ot_hours: Math.min(8, f.ot_hours + 1) }))} style={s.stepBtn}>
                          <Ionicons name="add" size={16} color={C.primary} />
                        </TouchableOpacity>
                      </View>
                    </View>
                    <View style={[s.formGroup, { flex: 1 }]}>
                      <Text style={s.formLabel}>Extra Mins</Text>
                      <View style={s.minRow}>
                        {[0, 15, 30, 45].map((m) => (
                          <TouchableOpacity key={m} style={[s.minBtn, form.ot_minutes === m && s.minBtnActive]} onPress={() => setForm((f) => ({ ...f, ot_minutes: m }))}>
                            <Text style={[s.minBtnText, form.ot_minutes === m && s.minBtnTextActive]}>{m}m</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  </View>
                  <View style={[s.infoBanner, { backgroundColor: payableHours > 0 ? C.successBg : C.bg, borderColor: payableHours > 0 ? C.success : C.border }]}>
                    {[
                      { label: 'Actual time', val: `${Math.floor(totalOtMin / 60)}h ${totalOtMin % 60}m`, color: C.text },
                      { label: 'Payable hours', val: `${payableHours}h`, color: payableHours > 0 ? C.success : C.danger },
                      { label: 'Est. OT pay', val: payableHours > 0 ? fmt(otPay) : '—', color: C.primary },
                    ].map((r) => (
                      <View key={r.label} style={s.otCalcRow}>
                        <Text style={s.otCalcLabel}>{r.label}</Text>
                        <Text style={[s.otCalcVal, { color: r.color }]}>{r.val}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
              {form.request_type === 'Late Arrival' && (
                <View style={s.formGroup}>
                  <Text style={s.formLabel}>How Late?</Text>
                  <TouchableOpacity style={s.select} onPress={() => setShowLateHoursPicker(true)} activeOpacity={0.8}>
                    <Text style={s.selectText}>{form.late_hours}</Text>
                    <Ionicons name="chevron-down" size={16} color={C.muted} />
                  </TouchableOpacity>
                </View>
              )}
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Reason</Text>
                <TextInput
                  style={[s.input, s.textarea]} value={form.reason}
                  onChangeText={(v) => setForm((f) => ({ ...f, reason: v }))}
                  placeholder="Brief reason…" placeholderTextColor={C.muted}
                  multiline numberOfLines={3}
                />
              </View>
              <View style={s.modalFooter}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setShowModal(false)}>
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.submitBtn, saving && { opacity: 0.6 }]} onPress={handleSubmit} disabled={saving} activeOpacity={0.85}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.submitText}>Submit</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <PickerModal visible={showTypePicker} title="Request Type" options={SPECIAL_TYPES} selected={form.request_type}
        onSelect={(t: SpecialType) => { setForm((f) => ({ ...f, request_type: t })); setShowTypePicker(false); }}
        onClose={() => setShowTypePicker(false)} colors={TYPE_COLORS} />
      <PickerModal visible={showLateHoursPicker} title="How Late?" options={LATE_HOUR_OPTIONS} selected={form.late_hours}
        onSelect={(o: typeof LATE_HOUR_OPTIONS[number]) => { setForm((f) => ({ ...f, late_hours: o })); setShowLateHoursPicker(false); }}
        onClose={() => setShowLateHoursPicker(false)} colors={{}} />
    </>
  );
}

const EMPTY_REG = { date: todayStr(), clockInTime: '', clockOutTime: '', reason: '' };

function RegularizeTab({ onOpenModal, onRefresh }: { onOpenModal: (open: () => void) => void; onRefresh: (fn: () => Promise<void>) => void }) {
  const { profile, tenant } = useAuth();
  const myShift = useMyShift();
  const shiftRef = useRef(myShift);
  shiftRef.current = myShift;
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_REG });
  const [saving, setSaving] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  // Same rule as the web's MyRegularizeRequestsPage: the self-approval banner
  // only makes sense when the tenant has regularize auto-approval switched on
  // (the DB trigger enforce_regularize_request_approval_tier re-derives the
  // tier from these columns). Raniwala regularizations always go to the
  // reporting manager, so it never sees the banner.
  const showQuota = !isRaniwalaTenant(tenant) && tenant?.regularize_auto_approval_enabled === true;
  const selfLimit = tenant?.regularize_auto_approval_limit ?? null;

  const fetchData = useCallback(async () => {
    if (!profile) return;
    const [reqRes, quotaRes] = await Promise.all([
      listMyRegularizeRequests(profile.id),
      tenant ? fetchMyQuota(tenant.id, profile.id) : null,
    ]);
    if (reqRes.error) showToast(reqRes.error.message || 'Could not load requests.', 'error');
    else setRequests(reqRes.data);
    if (quotaRes) setQuota(quotaRes);
  }, [profile, tenant]);

  useForegroundRefresh(fetchData, setLoading);

  useEffect(() => { onRefresh(fetchData); }, [fetchData]);

  const openModal = useCallback(() => {
    const sh = shiftRef.current;
    setForm({ date: todayStr(), clockInTime: sh.start || '', clockOutTime: sh.end || '', reason: '' });
    setShowModal(true);
  }, []);
  useEffect(() => { onOpenModal(openModal); }, []);

  const handleSubmit = async () => {
    if (!form.date) { showToast('Please select a date.', 'error'); return; }
    if (!DATE_RE.test(form.date) || isNaN(new Date(form.date).getTime())) {
      showToast('Please enter a valid date (YYYY-MM-DD).', 'error'); return;
    }
    if (form.date > todayStr()) { showToast('Cannot regularize a future date.', 'error'); return; }
    if (form.date < regularizeMinDate(tenant)) { showToast(`Regularization can only be requested for ${regularizeWindowLabel(tenant)}.`, 'error'); return; }
    if (!TIME_RE.test(form.clockInTime)) { showToast('Clock-in time must be in HH:MM (24h) format.', 'error'); return; }
    if (!TIME_RE.test(form.clockOutTime)) { showToast('Clock-out time must be in HH:MM (24h) format.', 'error'); return; }
    if (form.clockInTime >= form.clockOutTime) { showToast('Clock-out must be after clock-in.', 'error'); return; }
    if (!form.reason.trim()) { showToast('Reason is required.', 'error'); return; }
    if (!tenant) { showToast('You do not belong to any workspace.', 'error'); return; }
    setSaving(true);
    try {
      const { error, tier } = await submitRegularizeRequest(tenant.id, profile!.id, form);
      if (error) throw error;
      const msg = tier === 'self' ? 'Auto-approved! Attendance updated.' : tier === 'manager' ? 'Sent to your manager for approval — HR gets a copy.' : 'Sent to HR for approval.';
      showToast(msg, tier === 'self' ? 'success' : 'info');
      setShowModal(false); fetchData();
    } catch (err: any) {
      showToast('Failed: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <RegularizeExtensionNotice tenant={tenant} />
      {quota && showQuota && <QuotaBanner quota={selfLimit != null ? { ...quota, selfLimit } : quota} />}
      {loading ? (
        <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>
      ) : requests.length === 0 ? (
        <EmptyState icon="calendar-outline" title="No regularize requests" text="Missed a punch? Request an attendance correction." onPress={openModal} />
      ) : (
        <View style={s.list}>
          {requests.map((req) => {
            const ss = STATUS_STYLE[req.status] || STATUS_STYLE['Pending'];
            return (
              <View key={req.id} style={s.reqCard}>
                <View style={[s.reqStripe, { backgroundColor: C.purple }]} />
                <View style={s.reqContent}>
                  <View style={s.reqTop}>
                    <Text style={s.reqDate}>{fmtDate(req.date)}</Text>
                    <View style={[s.statusPill, { backgroundColor: ss.bg }]}>
                      <View style={[s.statusDot, { backgroundColor: ss.color }]} />
                      <Text style={[s.statusText, { color: ss.color }]}>{req.status}</Text>
                    </View>
                  </View>
                  <View style={s.punchRow}>
                    <View style={[s.punchPill, { backgroundColor: C.successBg }]}>
                      <Ionicons name="log-in-outline" size={12} color={C.success} />
                      <Text style={[s.punchTime, { color: C.success }]}>{fmtTime12(req.clock_in_time)}</Text>
                    </View>
                    <Ionicons name="arrow-forward" size={12} color={C.muted} />
                    <View style={[s.punchPill, { backgroundColor: C.dangerBg }]}>
                      <Ionicons name="log-out-outline" size={12} color={C.danger} />
                      <Text style={[s.punchTime, { color: C.danger }]}>{fmtTime12(req.clock_out_time)}</Text>
                    </View>
                  </View>
                  {!!req.reason && <Text style={s.reasonText} numberOfLines={2}>{req.reason}</Text>}
                  <Text style={s.appliedAt}>Submitted {fmtDate(req.created_at)}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <Modal visible={showModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <View style={s.modalTitleRow}>
                <View style={s.modalIconWrap}><Ionicons name="calendar-outline" size={16} color={C.primary} /></View>
                <Text style={s.modalTitle}>Regularize Attendance</Text>
              </View>
              <TouchableOpacity onPress={() => setShowModal(false)} style={s.closeBtn}>
                <Ionicons name="close" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.infoBanner}>
                <Ionicons name="information-circle-outline" size={14} color={C.primary} />
                <Text style={s.infoText}>Correct a missed or wrong punch for {regularizeWindowLabel(tenant)}. It goes to your reporting manager for approval and HR gets a copy — either of them can approve it.</Text>
              </View>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Date · {fmtDate(form.date)}</Text>
                {/* Any allowed day — at Raniwala the whole current month (tenants.regularize_current_month). */}
                <DayPicker
                  value={form.date}
                  min={regularizeMinDate(tenant)}
                  max={todayStr()}
                  onChange={(ds) => setForm((f) => ({ ...f, date: ds }))}
                />
              </View>
              <View style={s.row}>
                <View style={[s.formGroup, { flex: 1 }]}>
                  <Text style={s.formLabel}>Clock-In</Text>
                  <TextInput style={s.input} value={form.clockInTime}
                    onChangeText={(v) => setForm((f) => ({ ...f, clockInTime: v }))}
                    placeholder="HH:MM" placeholderTextColor={C.muted}
                    keyboardType="numeric" maxLength={5} />
                </View>
                <View style={[s.formGroup, { flex: 1 }]}>
                  <Text style={s.formLabel}>Clock-Out</Text>
                  <TextInput style={s.input} value={form.clockOutTime}
                    onChangeText={(v) => setForm((f) => ({ ...f, clockOutTime: v }))}
                    placeholder="HH:MM" placeholderTextColor={C.muted}
                    keyboardType="numeric" maxLength={5} />
                </View>
              </View>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Reason</Text>
                <TextInput style={[s.input, s.textarea]} value={form.reason}
                  onChangeText={(v) => setForm((f) => ({ ...f, reason: v }))}
                  placeholder="e.g. Forgot to clock in, device issue…"
                  placeholderTextColor={C.muted} multiline numberOfLines={3} />
              </View>
              <View style={s.modalFooter}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setShowModal(false)}>
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.submitBtn, saving && { opacity: 0.6 }]} onPress={handleSubmit} disabled={saving} activeOpacity={0.85}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.submitText}>Submit</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function EmptyState({ icon, title, text, onPress }: any) {
  return (
    <View style={s.emptyCard}>
      <View style={s.emptyIconWrap}>
        <Ionicons name={icon} size={32} color={C.primary} />
      </View>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyText}>{text}</Text>
      <TouchableOpacity style={s.emptyBtn} onPress={onPress}>
        <Ionicons name="add" size={16} color="#fff" />
        <Text style={s.emptyBtnText}>New Request</Text>
      </TouchableOpacity>
    </View>
  );
}

function PickerModal({ visible, title, options, selected, onSelect, onClose, colors }: any) {
  return (
    <Modal visible={visible} animationType="fade" transparent>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.pickerCard} onPress={() => {}}>
          <Text style={s.pickerTitle}>{title}</Text>
          {options.map((t: string) => {
            const tc = colors[t] || { color: C.primary, bg: C.primaryBg };
            return (
              <TouchableOpacity key={t}
                style={[s.pickerItem, selected === t && { backgroundColor: tc.bg || C.primaryBg }]}
                onPress={() => onSelect(t)}>
                {colors[t] && <View style={[s.pickerDot, { backgroundColor: tc.color }]} />}
                <Text style={[s.pickerText, selected === t && { color: tc.color || C.primary, fontWeight: '700' }]}>{t}</Text>
                {selected === t && <Ionicons name="checkmark-circle" size={18} color={tc.color || C.primary} />}
              </TouchableOpacity>
            );
          })}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

type TabKey = 'special' | 'regularize';

export default function RequestsScreen() {
  const { isEnabled } = useFeatures();
  const availableTabs = (['special', 'regularize'] as const).filter(
    (key) => isEnabled(key === 'special' ? 'special_requests' : 'regularize_attendance')
  );
  const [activeTab, setActiveTab] = useState<TabKey>('special');
  // Resolve against what's actually enabled so a hidden tab (e.g. Special for
  // Raniwala) never mounts, even for the one render before the effect below.
  const tab: TabKey | undefined = availableTabs.includes(activeTab) ? activeTab : availableTabs[0];
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!availableTabs.includes(activeTab) && availableTabs.length) setActiveTab(availableTabs[0]);
  }, [availableTabs.join(',')]);
  const openSpecialRef = React.useRef<() => void>(() => {});
  const openRegRef = React.useRef<() => void>(() => {});
  const refreshSpecialRef = React.useRef<() => Promise<void>>(async () => {});
  const refreshRegRef = React.useRef<() => Promise<void>>(async () => {});
  const tabAnim = useRef(new Animated.Value(0)).current;

  const openNew = () => {
    if (tab === 'special') openSpecialRef.current();
    else openRegRef.current();
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await (tab === 'special' ? refreshSpecialRef.current() : refreshRegRef.current());
    setRefreshing(false);
  };

  const switchTab = (key: TabKey) => {
    setActiveTab(key);
    Animated.spring(tabAnim, {
      toValue: key === 'special' ? 0 : 1,
      useNativeDriver: true, damping: 18, stiffness: 200,
    }).start();
  };

  const indicatorX = tabAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageHeader
        title="My Requests"
        subtitle={availableTabs.includes('special') ? 'Overtime, late arrival & attendance' : 'Attendance regularization'}
        right={(
          <TouchableOpacity style={s.addBtn} onPress={openNew} activeOpacity={0.85}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={s.addBtnText}>New</Text>
          </TouchableOpacity>
        )}
      />

      {/* Tab switcher */}
      {availableTabs.length > 1 && (
      <View style={s.tabContainer}>
        {availableTabs.map((key, idx) => {
          const icons = { special: 'flash-outline' as const, regularize: 'calendar-outline' as const };
          const labels = { special: 'Special', regularize: 'Regularize' };
          const isActive = tab === key;
          return (
            <TouchableOpacity
              key={key}
              style={[s.tabItem, isActive && s.tabItemActive]}
              onPress={() => switchTab(key)}
              activeOpacity={0.8}
            >
              <Ionicons name={icons[key]} size={15} color={isActive ? C.primary : C.muted} />
              <Text style={[s.tabLabel, isActive && s.tabLabelActive]}>{labels[key]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      )}

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.primary} colors={[C.primary]} />}>
        {!tab ? null : tab === 'special'
          ? <SpecialTab onOpenModal={(fn) => { openSpecialRef.current = fn; }} onRefresh={(fn) => { refreshSpecialRef.current = fn; }} />
          : <RegularizeTab onOpenModal={(fn) => { openRegRef.current = fn; }} onRefresh={(fn) => { refreshRegRef.current = fn; }} />}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.surface },
  scroll: { flex: 1, backgroundColor: C.bg },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.primary,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
  },
  addBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  // The website's tab strip: white bar, active tab underlined in primary.
  tabContainer: {
    flexDirection: 'row', backgroundColor: C.surface,
    paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  tabItem: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabItemActive: { borderBottomColor: C.primary },
  tabLabel: { fontSize: 13.5, fontWeight: '600', color: C.muted },
  tabLabelActive: { color: C.primary, fontWeight: '700' },
  loadingBox: { padding: 60, alignItems: 'center' },
  emptyCard: {
    margin: 14, backgroundColor: C.surface, borderRadius: 20,
    padding: 40, alignItems: 'center', gap: 10,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  emptyIconWrap: {
    width: 68, height: 68, borderRadius: 22, backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  emptyText: { fontSize: 13, color: C.muted, textAlign: 'center' },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 8, backgroundColor: C.primary, borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 11,
  },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  list: { padding: 14, gap: 12 },
  reqCard: {
    flexDirection: 'row', backgroundColor: C.surface, borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: C.border,
  },
  reqStripe: { width: 4 },
  reqContent: { flex: 1, padding: 14, gap: 7 },
  reqTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  typePill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  typePillText: { fontSize: 12, fontWeight: '700' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11.5, fontWeight: '700' },
  reqDate: { fontSize: 14, fontWeight: '700', color: C.text },
  reqMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reqMetaText: { fontSize: 12, color: C.muted },
  otPayText: { fontSize: 12.5, fontWeight: '600' },
  punchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  punchPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 },
  punchTime: { fontSize: 12.5, fontWeight: '700' },
  reasonText: { fontSize: 12.5, color: C.muted, lineHeight: 18 },
  appliedAt: { fontSize: 11, color: '#CBD5E1' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, maxHeight: '90%',
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: C.border,
    alignSelf: 'center', marginBottom: 16,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalIconWrap: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: C.text },
  closeBtn: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: C.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  formGroup: { marginBottom: 14 },
  formLabel: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 7 },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: C.text, backgroundColor: C.surface,
  },
  textarea: { height: 88, textAlignVertical: 'top' },
  select: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1.5, borderColor: C.border, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 13, backgroundColor: '#FAFAFA',
  },
  selectDot: { width: 10, height: 10, borderRadius: 5 },
  selectText: { flex: 1, fontSize: 14, color: C.text, fontWeight: '500' },
  row: { flexDirection: 'row', gap: 12 },
  infoBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary,
    borderRadius: 12, padding: 12, marginBottom: 14,
  },
  infoText: { flex: 1, fontSize: 12, color: C.primary, lineHeight: 17 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: {
    width: 32, height: 32, borderRadius: 10, borderWidth: 1.5, borderColor: C.primary,
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.primaryBg,
  },
  stepVal: { fontSize: 15, fontWeight: '700', color: C.text, minWidth: 30, textAlign: 'center' },
  minRow: { flexDirection: 'row', gap: 6 },
  minBtn: {
    paddingHorizontal: 8, paddingVertical: 7, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.bg,
  },
  minBtnActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  minBtnText: { fontSize: 11.5, color: C.muted, fontWeight: '600' },
  minBtnTextActive: { color: C.primary },
  otCalcRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  otCalcLabel: { fontSize: 12, color: C.muted },
  otCalcVal: { fontSize: 13, fontWeight: '700' },
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
});
