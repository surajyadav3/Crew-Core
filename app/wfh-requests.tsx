import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { listMyWfhRequests, submitWfhRequest, cancelWfhRequest } from '@/services/wfhService';
import { showToast } from '@/components/Toast';
import { fmtDate, todayStr } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMPTY_FORM = { from_date: todayStr(), to_date: todayStr(), reason: '' };

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Pending: { bg: C.warningBg, color: C.warning },
  Approved: { bg: C.successBg, color: C.success },
  Rejected: { bg: C.dangerBg, color: C.danger },
};

export default function WfhRequestsScreen() {
  const router = useRouter();
  const { profile, tenant } = useAuth();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await listMyWfhRequests(profile.id);
    if (error) showToast(error.message || 'Could not load requests.', 'error');
    else setRequests(data);
  }, [profile]);

  useFocusEffect(useCallback(() => { setLoading(true); fetchData().finally(() => setLoading(false)); }, [fetchData]));

  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const openModal = () => { setForm({ ...EMPTY_FORM }); setShowModal(true); };

  const handleSubmit = async () => {
    if (!tenant || !profile) { showToast('Account setup incomplete.', 'error'); return; }
    if (!DATE_RE.test(form.from_date) || !DATE_RE.test(form.to_date)) { showToast('Dates must be YYYY-MM-DD.', 'error'); return; }
    if (form.to_date < form.from_date) { showToast('End date must be on or after start date.', 'error'); return; }
    if (!form.reason.trim()) { showToast('Please provide a reason.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await submitWfhRequest({
        tenantId: tenant.id, profileId: profile.id, fromDate: form.from_date, toDate: form.to_date, reason: form.reason.trim(),
      });
      if (error) throw error;
      showToast('WFH request submitted — awaiting review.', 'success');
      setShowModal(false);
      fetchData();
    } catch (err: any) {
      showToast('Failed: ' + (err.message || 'Something went wrong'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (id: string) => {
    const { error } = await cancelWfhRequest(id);
    if (error) showToast(error.message || 'Failed to cancel.', 'error');
    else { showToast('Request cancelled.', 'success'); fetchData(); }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Work From Home</Text>
          <Text style={s.subtitle}>Request remote days</Text>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={openModal} activeOpacity={0.85}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={s.addBtnText}>New</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}>
        {loading ? (
          <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>
        ) : requests.length === 0 ? (
          <View style={s.emptyCard}>
            <View style={s.emptyIconWrap}><Ionicons name="home-outline" size={32} color={C.primary} /></View>
            <Text style={s.emptyTitle}>No WFH requests yet</Text>
            <Text style={s.emptyText}>Working remotely? Submit a request for manager approval.</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={openModal}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={s.emptyBtnText}>New Request</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.list}>
            {requests.map((r) => {
              const ss = STATUS_STYLE[r.status] || STATUS_STYLE.Pending;
              return (
                <View key={r.id} style={s.card}>
                  <View style={[s.cardStripe, { backgroundColor: ss.color }]} />
                  <View style={s.cardContent}>
                    <View style={s.cardTop}>
                      <Text style={s.cardDate}>{fmtDate(r.from_date)} – {fmtDate(r.to_date)}</Text>
                      <View style={[s.statusPill, { backgroundColor: ss.bg }]}>
                        <View style={[s.statusDot, { backgroundColor: ss.color }]} />
                        <Text style={[s.statusText, { color: ss.color }]}>{r.status}</Text>
                      </View>
                    </View>
                    {!!r.reason && <Text style={s.reasonText} numberOfLines={2}>{r.reason}</Text>}
                    <Text style={s.appliedAt}>Submitted {fmtDate(r.created_at)}</Text>
                    {r.status === 'Pending' && (
                      <TouchableOpacity style={s.deleteBtn} onPress={() => handleCancel(r.id)}>
                        <Ionicons name="close-circle-outline" size={13} color={C.danger} />
                        <Text style={s.deleteBtnText}>Cancel</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal visible={showModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>New WFH Request</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} style={s.closeBtn}>
                <Ionicons name="close" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.infoBanner}>
                <Ionicons name="information-circle-outline" size={14} color={C.primary} />
                <Text style={s.infoText}>WFH requests always need manager or admin approval — clock-in geofencing is bypassed once approved.</Text>
              </View>
              <View style={s.row}>
                <View style={[s.formGroup, { flex: 1 }]}>
                  <Text style={s.formLabel}>From</Text>
                  <TextInput style={s.input} value={form.from_date} placeholder="YYYY-MM-DD" placeholderTextColor={C.muted}
                    keyboardType="numeric" maxLength={10} onChangeText={(v) => setForm((f) => ({ ...f, from_date: v }))} />
                </View>
                <View style={[s.formGroup, { flex: 1 }]}>
                  <Text style={s.formLabel}>To</Text>
                  <TextInput style={s.input} value={form.to_date} placeholder="YYYY-MM-DD" placeholderTextColor={C.muted}
                    keyboardType="numeric" maxLength={10} onChangeText={(v) => setForm((f) => ({ ...f, to_date: v }))} />
                </View>
              </View>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Reason</Text>
                <TextInput style={[s.input, s.textarea]} value={form.reason} multiline numberOfLines={3}
                  placeholder="Why are you working from home?" placeholderTextColor={C.muted}
                  onChangeText={(v) => setForm((f) => ({ ...f, reason: v }))} />
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
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.dark },
  scroll: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, backgroundColor: C.dark },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '900', color: '#fff' },
  subtitle: { fontSize: 12.5, color: 'rgba(255,255,255,0.4)', marginTop: 1 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14 },
  addBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  loadingBox: { padding: 60, alignItems: 'center' },
  emptyCard: { margin: 14, backgroundColor: C.surface, borderRadius: 20, padding: 40, alignItems: 'center', gap: 10, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  emptyIconWrap: { width: 68, height: 68, borderRadius: 22, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  emptyText: { fontSize: 13, color: C.muted, textAlign: 'center' },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 11 },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  list: { padding: 14, gap: 12 },
  card: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: 18, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  cardStripe: { width: 5 },
  cardContent: { flex: 1, padding: 14, gap: 7 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardDate: { fontSize: 14, fontWeight: '700', color: C.text },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11.5, fontWeight: '700' },
  reasonText: { fontSize: 12.5, color: C.muted, lineHeight: 18 },
  appliedAt: { fontSize: 11, color: '#94A3B8' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 2 },
  deleteBtnText: { fontSize: 12, color: C.danger, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, maxHeight: '90%' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: C.text },
  closeBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  infoBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary, borderRadius: 12, padding: 12, marginBottom: 14 },
  infoText: { flex: 1, fontSize: 12, color: C.primary, lineHeight: 17 },
  formGroup: { marginBottom: 14 },
  formLabel: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 7 },
  input: { borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: C.text, backgroundColor: '#FAFAFA' },
  textarea: { height: 88, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 12 },
  modalFooter: { flexDirection: 'row', gap: 12, marginTop: 8, paddingBottom: 12 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: C.muted },
  submitBtn: { flex: 1, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 10, elevation: 5 },
  submitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
