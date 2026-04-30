import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { listMyLeaveRequests, requestLeave } from '@/services/leaveService';
import { showToast } from '@/components/Toast';
import { fmtDate, todayStr } from '@/lib/helpers';

const C = {
  primary: '#00AEEF',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  text: '#1E293B',
  muted: '#94A3B8',
  border: '#E2E8F0',
  success: '#22C55E',
  danger: '#EF4444',
  warning: '#F59E0B',
  purple: '#8B5CF6',
};

const LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Paid Leave', 'Maternity/Paternity Leave', 'Loss of Pay'];

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Approved: { bg: '#F0FDF4', color: C.success },
  Rejected: { bg: '#FEF2F2', color: C.danger },
  Pending: { bg: '#FFFBEB', color: C.warning },
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

  const fetchRequests = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    const { data, error } = await listMyLeaveRequests(profile.id);
    if (error) showToast(error.message, 'error');
    else setRequests(data);
    setLoading(false);
  }, [profile]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleSubmit = async () => {
    if (!form.reason.trim()) { showToast('Please provide a reason.', 'error'); return; }
    if (!form.start_date || !form.end_date) { showToast('Please select both dates.', 'error'); return; }
    if (form.end_date < form.start_date) { showToast('End date cannot be before start date.', 'error'); return; }
    if (!tenant) { showToast('You do not belong to any workspace.', 'error'); return; }

    setSaving(true);
    try {
      const payload = {
        ...form,
        profile_id: profile!.id,
        tenant_id: tenant.id,
        status: 'Pending',
      };
      const { error } = await requestLeave(payload);
      if (error) {
        showToast(error.message || 'Failed to submit leave request.', 'error');
      } else {
        setRequests((prev) => [{ ...payload, id: Math.random().toString(), created_at: new Date().toISOString() }, ...prev]);
        showToast('Leave request submitted!', 'success');
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
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.title}>My Leaves</Text>
          <Text style={s.subtitle}>Leave requests & history</Text>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={() => setShowModal(true)}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={s.addBtnText}>Request</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={s.loadingBox}>
            <ActivityIndicator color={C.primary} />
          </View>
        ) : requests.length === 0 ? (
          <View style={s.emptyCard}>
            <Ionicons name="calendar-outline" size={40} color={C.muted} />
            <Text style={s.emptyTitle}>No leave requests yet</Text>
            <Text style={s.emptyText}>Tap "Request" to apply for leave.</Text>
          </View>
        ) : (
          <View style={s.list}>
            {requests.map((req) => {
              const statusStyle = STATUS_STYLE[req.status] || STATUS_STYLE['Pending'];
              return (
                <View key={req.id} style={s.card}>
                  <View style={s.cardTop}>
                    <View style={[s.typeBadge]}>
                      <Text style={s.typeBadgeText}>{req.leave_type}</Text>
                    </View>
                    <View style={[s.statusBadge, { backgroundColor: statusStyle.bg }]}>
                      <Text style={[s.statusText, { color: statusStyle.color }]}>{req.status}</Text>
                    </View>
                  </View>
                  <View style={s.cardDates}>
                    <Ionicons name="calendar-outline" size={14} color={C.muted} />
                    <Text style={s.datesText}>
                      {fmtDate(req.start_date)} — {fmtDate(req.end_date)}
                    </Text>
                    <Text style={s.daysText}>{daysBetween(req.start_date, req.end_date)} day{daysBetween(req.start_date, req.end_date) !== 1 ? 's' : ''}</Text>
                  </View>
                  {!!req.reason && <Text style={s.reasonText} numberOfLines={2}>{req.reason}</Text>}
                  <Text style={s.appliedText}>Applied {fmtDate(req.created_at)}</Text>
                </View>
              );
            })}
          </View>
        )}
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Request Leave Modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Request Leave</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} style={s.closeBtn}>
                <Ionicons name="close" size={22} color={C.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Leave type */}
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Leave Type</Text>
                <TouchableOpacity style={s.select} onPress={() => setShowTypePicker(true)}>
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
                  style={[s.input, s.textarea]}
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
                <TouchableOpacity style={[s.submitBtn, saving && { opacity: 0.6 }]} onPress={handleSubmit} disabled={saving}>
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.submitText}>Submit Request</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Type picker modal */}
      <Modal visible={showTypePicker} animationType="fade" transparent>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowTypePicker(false)}>
          <View style={s.pickerCard}>
            <Text style={[s.modalTitle, { marginBottom: 12 }]}>Select Leave Type</Text>
            {LEAVE_TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                style={[s.pickerItem, form.leave_type === t && { backgroundColor: C.primary + '15' }]}
                onPress={() => { setForm((f) => ({ ...f, leave_type: t })); setShowTypePicker(false); }}
              >
                <Text style={[s.pickerText, form.leave_type === t && { color: C.primary, fontWeight: '700' }]}>{t}</Text>
                {form.leave_type === t && <Ionicons name="checkmark" size={16} color={C.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F0FFF4' },
  scroll: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, backgroundColor: '#F0FFF4',
  },
  title: { fontSize: 22, fontWeight: '800', color: C.text },
  subtitle: { fontSize: 13, color: C.muted, marginTop: 2 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  loadingBox: { padding: 48, alignItems: 'center' },
  emptyCard: {
    margin: 16, backgroundColor: C.surface, borderRadius: 16,
    padding: 40, alignItems: 'center', gap: 8,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: C.text },
  emptyText: { fontSize: 13, color: C.muted },
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: C.surface, borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 3,
    gap: 8,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  typeBadge: { backgroundColor: '#E0F7FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  typeBadgeText: { fontSize: 12, color: C.primary, fontWeight: '600' },
  statusBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: '700' },
  cardDates: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  datesText: { fontSize: 13, color: C.text },
  daysText: { fontSize: 12, color: C.muted, marginLeft: 4 },
  reasonText: { fontSize: 13, color: C.muted },
  appliedText: { fontSize: 11, color: '#CBD5E1' },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, maxHeight: '85%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  closeBtn: { padding: 4 },
  formGroup: { marginBottom: 16 },
  formLabel: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: C.text,
    backgroundColor: '#F8FAFC',
  },
  textarea: { height: 90, textAlignVertical: 'top' },
  select: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1.5, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#F8FAFC',
  },
  selectText: { fontSize: 14, color: C.text },
  row: { flexDirection: 'row', gap: 12, marginBottom: 0 },
  modalFooter: { flexDirection: 'row', gap: 12, marginTop: 8, paddingBottom: 16 },
  cancelBtn: {
    flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 12,
    paddingVertical: 13, alignItems: 'center',
  },
  cancelText: { fontSize: 14, fontWeight: '600', color: C.text },
  submitBtn: {
    flex: 1, backgroundColor: C.primary, borderRadius: 12,
    paddingVertical: 13, alignItems: 'center',
    shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  submitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  pickerCard: {
    alignSelf: 'center', backgroundColor: C.surface, borderRadius: 20,
    padding: 20, width: '80%', maxWidth: 320, marginTop: 'auto', marginBottom: 'auto',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, elevation: 8,
  },
  pickerItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 10, borderRadius: 10,
  },
  pickerText: { fontSize: 14, color: C.text },
});
