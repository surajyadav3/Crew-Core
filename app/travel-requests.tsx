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
import { TRAVEL_MODES, listMyTravelRequests, createTravelRequest, deleteTravelRequest } from '@/services/travelService';
import { showToast } from '@/components/Toast';
import { fmt, fmtDate, todayStr } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Pending: { bg: C.warningBg, color: C.warning },
  Approved: { bg: C.successBg, color: C.success },
  Rejected: { bg: C.dangerBg, color: C.danger },
};

type Leg = { key: string; from_city: string; to_city: string; travel_date: string; mode: string };
const newLeg = (): Leg => ({ key: String(Date.now() + Math.random()), from_city: '', to_city: '', travel_date: todayStr(), mode: TRAVEL_MODES[0] });
const EMPTY_FORM = { purpose: '', from_date: todayStr(), to_date: todayStr(), estimated_cost: '' };

export default function TravelRequestsScreen() {
  const router = useRouter();
  const { profile, tenant } = useAuth();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [legs, setLegs] = useState<Leg[]>([newLeg()]);
  const [saving, setSaving] = useState(false);
  const [showModePicker, setShowModePicker] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await listMyTravelRequests(profile.id);
    if (error) showToast(error.message || 'Could not load travel requests.', 'error');
    else setRequests(data);
  }, [profile]);

  useFocusEffect(useCallback(() => { setLoading(true); fetchData().finally(() => setLoading(false)); }, [fetchData]));

  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const openModal = () => { setForm({ ...EMPTY_FORM }); setLegs([newLeg()]); setShowModal(true); };

  const handleSubmit = async () => {
    if (!tenant || !profile) { showToast('Account setup incomplete.', 'error'); return; }
    if (!form.purpose.trim()) { showToast('Please provide a purpose.', 'error'); return; }
    if (!DATE_RE.test(form.from_date) || !DATE_RE.test(form.to_date)) { showToast('Dates must be YYYY-MM-DD.', 'error'); return; }
    if (form.to_date < form.from_date) { showToast('End date must be on or after start date.', 'error'); return; }
    const invalidLeg = legs.some((l) => !l.from_city.trim() || !l.to_city.trim() || !DATE_RE.test(l.travel_date));
    if (invalidLeg) { showToast('Every leg needs a from/to city and a valid date.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await createTravelRequest(tenant.id, profile.id, form, legs);
      if (error) throw error;
      showToast('Travel request submitted!', 'success');
      setShowModal(false);
      fetchData();
    } catch (err: any) {
      showToast('Failed: ' + (err.message || 'Something went wrong'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await deleteTravelRequest(id);
    if (error) showToast(error.message || 'Failed to delete.', 'error');
    else { showToast('Request deleted.', 'success'); fetchData(); }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Travel Requests</Text>
          <Text style={s.subtitle}>Plan and track work travel</Text>
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
            <View style={s.emptyIconWrap}><Ionicons name="airplane-outline" size={32} color={C.primary} /></View>
            <Text style={s.emptyTitle}>No travel requests yet</Text>
            <Text style={s.emptyText}>Planning a work trip? Submit a request here.</Text>
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
                      <Text style={s.cardPurpose} numberOfLines={1}>{r.purpose}</Text>
                      <View style={[s.statusPill, { backgroundColor: ss.bg }]}>
                        <View style={[s.statusDot, { backgroundColor: ss.color }]} />
                        <Text style={[s.statusText, { color: ss.color }]}>{r.status}</Text>
                      </View>
                    </View>
                    <View style={s.metaRow}>
                      <Ionicons name="calendar-outline" size={12} color={C.muted} />
                      <Text style={s.metaText}>{fmtDate(r.from_date)} – {fmtDate(r.to_date)}</Text>
                      <Text style={s.metaText}> · Est. {fmt(r.estimated_cost)}</Text>
                    </View>
                    {(r.legs || []).map((l: any) => (
                      <View key={l.id} style={s.legRow}>
                        <Text style={s.legText}>{l.from_city} → {l.to_city}</Text>
                        <Text style={s.legMeta}>{fmtDate(l.travel_date)} · {l.mode}</Text>
                      </View>
                    ))}
                    <Text style={s.appliedAt}>Submitted {fmtDate(r.created_at)}</Text>
                    {r.status === 'Pending' && (
                      <TouchableOpacity style={s.deleteBtn} onPress={() => handleDelete(r.id)}>
                        <Ionicons name="trash-outline" size={13} color={C.danger} />
                        <Text style={s.deleteBtnText}>Delete</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal visible={showModal && !showModePicker} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>New Travel Request</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} style={s.closeBtn}>
                <Ionicons name="close" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Purpose</Text>
                <TextInput style={s.input} value={form.purpose} placeholder="Client visit, conference, …" placeholderTextColor={C.muted}
                  onChangeText={(v) => setForm((f) => ({ ...f, purpose: v }))} />
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
                <Text style={s.formLabel}>Estimated Cost</Text>
                <TextInput style={s.input} value={form.estimated_cost} placeholder="0" placeholderTextColor={C.muted}
                  keyboardType="numeric" onChangeText={(v) => setForm((f) => ({ ...f, estimated_cost: v }))} />
              </View>

              <Text style={[s.formLabel, { marginBottom: 10 }]}>Legs</Text>
              {legs.map((l, idx) => (
                <View key={l.key} style={s.legCard}>
                  <View style={s.itemHeader}>
                    <Text style={s.itemLabel}>Leg {idx + 1}</Text>
                    {legs.length > 1 && (
                      <TouchableOpacity onPress={() => setLegs((prev) => prev.filter((p) => p.key !== l.key))}>
                        <Ionicons name="close-circle" size={18} color={C.danger} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={s.row}>
                    <TextInput style={[s.input, { flex: 1 }]} value={l.from_city} placeholder="From city" placeholderTextColor={C.muted}
                      onChangeText={(v) => setLegs((prev) => prev.map((p) => (p.key === l.key ? { ...p, from_city: v } : p)))} />
                    <TextInput style={[s.input, { flex: 1 }]} value={l.to_city} placeholder="To city" placeholderTextColor={C.muted}
                      onChangeText={(v) => setLegs((prev) => prev.map((p) => (p.key === l.key ? { ...p, to_city: v } : p)))} />
                  </View>
                  <View style={s.row}>
                    <TextInput style={[s.input, { flex: 1 }]} value={l.travel_date} placeholder="YYYY-MM-DD" placeholderTextColor={C.muted}
                      keyboardType="numeric" maxLength={10} onChangeText={(v) => setLegs((prev) => prev.map((p) => (p.key === l.key ? { ...p, travel_date: v } : p)))} />
                    <TouchableOpacity style={[s.select, { flex: 1 }]} onPress={() => setShowModePicker(l.key)}>
                      <Text style={s.selectText}>{l.mode}</Text>
                      <Ionicons name="chevron-down" size={16} color={C.muted} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              <TouchableOpacity style={s.addItemBtn} onPress={() => setLegs((prev) => [...prev, newLeg()])}>
                <Ionicons name="add" size={16} color={C.primary} />
                <Text style={s.addItemText}>Add another leg</Text>
              </TouchableOpacity>

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

      <Modal visible={!!showModePicker} animationType="fade" transparent>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowModePicker(null)}>
          <TouchableOpacity activeOpacity={1} style={s.pickerCard} onPress={() => {}}>
            <Text style={s.pickerTitle}>Travel Mode</Text>
            {TRAVEL_MODES.map((m) => (
              <TouchableOpacity key={m} style={s.pickerItem}
                onPress={() => {
                  setLegs((prev) => prev.map((p) => (p.key === showModePicker ? { ...p, mode: m } : p)));
                  setShowModePicker(null);
                }}>
                <Text style={s.pickerText}>{m}</Text>
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
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
  cardContent: { flex: 1, padding: 14, gap: 8 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardPurpose: { fontSize: 15, fontWeight: '700', color: C.text, flex: 1 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11.5, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: C.muted },
  legRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.bg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  legText: { fontSize: 12.5, fontWeight: '600', color: C.text },
  legMeta: { fontSize: 11.5, color: C.muted },
  appliedAt: { fontSize: 11, color: '#94A3B8' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 2 },
  deleteBtnText: { fontSize: 12, color: C.danger, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, maxHeight: '90%' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: C.text },
  closeBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  formGroup: { marginBottom: 14 },
  formLabel: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 7 },
  input: { borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: C.text, backgroundColor: '#FAFAFA' },
  row: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: '#FAFAFA' },
  selectText: { fontSize: 14, color: C.text, fontWeight: '500' },
  legCard: { backgroundColor: C.bg, borderRadius: 16, padding: 14, marginBottom: 12 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  itemLabel: { fontSize: 12.5, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: C.primary, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 12, marginBottom: 14 },
  addItemText: { fontSize: 13.5, color: C.primary, fontWeight: '700' },
  modalFooter: { flexDirection: 'row', gap: 12, marginTop: 4, paddingBottom: 12 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: C.muted },
  submitBtn: { flex: 1, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 10, elevation: 5 },
  submitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  pickerCard: { alignSelf: 'center', backgroundColor: C.surface, borderRadius: 24, padding: 20, width: '85%', maxWidth: 340, marginTop: 'auto', marginBottom: 'auto', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 24, elevation: 12 },
  pickerTitle: { fontSize: 16, fontWeight: '800', color: C.text, marginBottom: 14 },
  pickerItem: { paddingVertical: 12, paddingHorizontal: 10, borderRadius: 12 },
  pickerText: { fontSize: 14, color: C.text },
});
