import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { listMyLeaveRequests, requestLeave, checkProbationStatus } from '@/services/leaveService';
import { fetchMyQuota } from '@/services/requestQuotaService';
import { showToast } from '@/components/Toast';
import { fmtDate, todayStr, HIGH_SALARY_THRESHOLD } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

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

const BASE_LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Paid Leave', 'Maternity/Paternity Leave', 'Loss of Pay'];

const LEAVE_COLORS: Record<string, { color: string; bg: string }> = {
  'Casual Leave': { color: C.primary, bg: C.primaryBg },
  'Sick Leave': { color: C.danger, bg: C.dangerBg },
  'Paid Leave': { color: C.success, bg: C.successBg },
  'Maternity/Paternity Leave': { color: '#8B5CF6', bg: '#EDE9FE' },
  'Loss of Pay': { color: C.warning, bg: C.warningBg },
  'Comp Off': { color: C.teal, bg: C.tealBg },
  'Earned (Probation)': { color: '#F97316', bg: '#FFEDD5' },
};

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Approved: { bg: C.successBg, color: C.success },
  Rejected: { bg: C.dangerBg, color: C.danger },
  Pending: { bg: C.warningBg, color: C.warning },
};

const EMPTY_FORM = {
  leave_type: 'Casual Leave',
  start_date: todayStr(),
  end_date: todayStr(),
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
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [probation, setProbation] = useState<{ inProbation: boolean; endsOn: string | null; earnedLeaves: number } | null>(null);

  const hasCompOff = (profile?.ctc || 0) >= HIGH_SALARY_THRESHOLD && (profile?.comp_off_balance || 0) > 0;
  const leaveTypes = probation?.inProbation
    ? ['Earned (Probation)']
    : [...BASE_LEAVE_TYPES, ...(hasCompOff ? ['Comp Off'] : [])];

  const fetchRequests = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    const [reqRes, probRes, quotaRes] = await Promise.all([
      listMyLeaveRequests(profile.id),
      checkProbationStatus(profile.id),
      tenant ? fetchMyQuota(tenant.id, profile.id) : null,
    ]);
    if (reqRes.error) showToast(reqRes.error.message, 'error');
    else setRequests(reqRes.data);
    setProbation(probRes);
    if (quotaRes) setQuota(quotaRes);
    setLoading(false);
  }, [profile, tenant]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleSubmit = async () => {
    if (!form.reason.trim()) { showToast('Please provide a reason.', 'error'); return; }
    if (!form.start_date || !form.end_date) { showToast('Please select both dates.', 'error'); return; }
    if (form.end_date < form.start_date) { showToast('End date cannot be before start date.', 'error'); return; }
    if (!tenant) { showToast('You do not belong to any workspace.', 'error'); return; }
    if (probation?.inProbation && form.leave_type !== 'Earned (Probation)') {
      showToast(`You are in probation until ${fmtDate(probation.endsOn)}. Only earned probation leaves can be used.`, 'error');
      return;
    }
    if (probation?.inProbation && form.leave_type === 'Earned (Probation)' && (probation.earnedLeaves || 0) <= 0) {
      showToast('You have no earned probation leaves yet. Work all days in a month to earn one.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, profile_id: profile!.id, tenant_id: tenant.id, status: 'Pending' };
      const { error, tier } = await requestLeave(payload);
      if (error) {
        showToast(error.message || 'Failed to submit leave request.', 'error');
      } else {
        const msg = tier === 'self' ? 'Auto-approved!' : tier === 'manager' ? 'Sent to Manager for approval.' : 'Submitted for HR approval.';
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
      <View style={s.header}>
        <View>
          <Text style={s.title}>My Leaves</Text>
          <Text style={s.subtitle}>Requests & history</Text>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={() => setShowModal(true)} activeOpacity={0.85}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={s.addBtnText}>Request</Text>
        </TouchableOpacity>
      </View>

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
      {hasCompOff && !probation?.inProbation && (
        <View style={[s.infoBanner, { borderLeftColor: C.primary, backgroundColor: C.primaryBg }]}>
          <Ionicons name="gift-outline" size={15} color={C.primary} />
          <Text style={[s.infoBannerText, { color: C.primary }]}>
            You have <Text style={{ fontWeight: '700' }}>{profile?.comp_off_balance}</Text> Comp Off{(profile?.comp_off_balance || 0) > 1 ? 's' : ''} available.
          </Text>
        </View>
      )}
      {quota && <QuotaBanner quota={quota} />}

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}>
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
                      <Text style={s.datesText}>{fmtDate(req.start_date)} — {fmtDate(req.end_date)}</Text>
                      <View style={s.daysBadge}>
                        <Text style={s.daysText}>{days}d</Text>
                      </View>
                    </View>
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
      <Modal visible={showModal} animationType="slide" transparent>
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
                  <Ionicons name="chevron-down" size={16} color={C.muted} />
                </TouchableOpacity>
              </View>

              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <DateInput label="Start Date" value={form.start_date} onChange={(v) => setForm((f) => ({ ...f, start_date: v }))} />
                </View>
                <View style={{ flex: 1 }}>
                  <DateInput label="End Date" value={form.end_date} onChange={(v) => setForm((f) => ({ ...f, end_date: v }))} />
                </View>
              </View>

              <View style={s.formGroup}>
                <Text style={s.formLabel}>Reason</Text>
                <TextInput
                  style={[s.inputRaw, s.textarea]}
                  value={form.reason}
                  onChangeText={(v) => setForm((f) => ({ ...f, reason: v }))}
                  placeholder="Please provide a brief reason…"
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
  safe: { flex: 1, backgroundColor: C.dark },
  scroll: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16, backgroundColor: C.dark,
  },
  title: { fontSize: 24, fontWeight: '900', color: '#fff' },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14,
    shadowColor: C.primary, shadowOpacity: 0.4, shadowRadius: 10, elevation: 5,
  },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
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
  row: { flexDirection: 'row', gap: 12, marginBottom: 0 },
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
