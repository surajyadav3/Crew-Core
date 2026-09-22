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
import { GRIEVANCE_TYPES, listMyGrievances, fileGrievance } from '@/services/grievanceService';
import { showToast } from '@/components/Toast';
import { fmtDate } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Open: { bg: C.warningBg, color: C.warning },
  'Under Review': { bg: C.primaryBg, color: C.primary },
  Resolved: { bg: C.successBg, color: C.success },
  Dismissed: { bg: C.dangerBg, color: C.danger },
};

const EMPTY_FORM = { type: GRIEVANCE_TYPES[GRIEVANCE_TYPES.length - 1], description: '' };

export default function GrievanceScreen() {
  const router = useRouter();
  const { profile, tenant } = useAuth();
  const [grievances, setGrievances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await listMyGrievances(profile.id);
    if (error) showToast(error.message || 'Could not load grievances.', 'error');
    else setGrievances(data);
  }, [profile]);

  useFocusEffect(useCallback(() => { setLoading(true); fetchData().finally(() => setLoading(false)); }, [fetchData]));

  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const openModal = () => { setForm({ ...EMPTY_FORM }); setShowModal(true); };

  const handleSubmit = async () => {
    if (!tenant || !profile) { showToast('Account setup incomplete.', 'error'); return; }
    if (!form.description.trim()) { showToast('Please describe the issue.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await fileGrievance(tenant.id, profile.id, form.type, form.description.trim());
      if (error) throw error;
      showToast('Grievance filed — HR will review it confidentially.', 'success');
      setShowModal(false);
      fetchData();
    } catch (err: any) {
      showToast('Failed: ' + (err.message || 'Something went wrong'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Grievance</Text>
          <Text style={s.subtitle}>Confidential — HR only</Text>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={openModal} activeOpacity={0.85}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={s.addBtnText}>New</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}>
        <View style={s.infoBanner}>
          <Ionicons name="lock-closed-outline" size={14} color={C.primary} />
          <Text style={s.infoText}>Grievances are visible only to you and HR — never your manager.</Text>
        </View>
        {loading ? (
          <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>
        ) : grievances.length === 0 ? (
          <View style={s.emptyCard}>
            <View style={s.emptyIconWrap}><Ionicons name="shield-outline" size={32} color={C.primary} /></View>
            <Text style={s.emptyTitle}>No grievances filed</Text>
            <Text style={s.emptyText}>Something on your mind? File it here — only HR will see it.</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={openModal}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={s.emptyBtnText}>File a Grievance</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.list}>
            {grievances.map((g) => {
              const ss = STATUS_STYLE[g.status] || STATUS_STYLE.Open;
              return (
                <View key={g.id} style={s.card}>
                  <View style={[s.cardStripe, { backgroundColor: ss.color }]} />
                  <View style={s.cardContent}>
                    <View style={s.cardTop}>
                      <Text style={s.cardType}>{g.type}</Text>
                      <View style={[s.statusPill, { backgroundColor: ss.bg }]}>
                        <View style={[s.statusDot, { backgroundColor: ss.color }]} />
                        <Text style={[s.statusText, { color: ss.color }]}>{g.status}</Text>
                      </View>
                    </View>
                    <Text style={s.descText}>{g.description}</Text>
                    {!!g.resolution_notes && (
                      <View style={s.resolutionBox}>
                        <Text style={s.resolutionLabel}>HR's response</Text>
                        <Text style={s.resolutionText}>{g.resolution_notes}</Text>
                      </View>
                    )}
                    <Text style={s.appliedAt}>Filed {fmtDate(g.created_at)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal visible={showModal && !showTypePicker} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>File a Grievance</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} style={s.closeBtn}>
                <Ionicons name="close" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Type</Text>
                <TouchableOpacity style={s.select} onPress={() => setShowTypePicker(true)} activeOpacity={0.8}>
                  <Text style={s.selectText}>{form.type}</Text>
                  <Ionicons name="chevron-down" size={16} color={C.muted} />
                </TouchableOpacity>
              </View>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Description</Text>
                <TextInput style={[s.input, s.textarea]} value={form.description} multiline numberOfLines={5}
                  placeholder="Describe what happened, when, and who was involved…" placeholderTextColor={C.muted}
                  onChangeText={(v) => setForm((f) => ({ ...f, description: v }))} />
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

      <Modal visible={showTypePicker} animationType="fade" transparent>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowTypePicker(false)}>
          <TouchableOpacity activeOpacity={1} style={s.pickerCard} onPress={() => {}}>
            <Text style={s.pickerTitle}>Type</Text>
            {GRIEVANCE_TYPES.map((t) => (
              <TouchableOpacity key={t} style={s.pickerItem}
                onPress={() => { setForm((f) => ({ ...f, type: t })); setShowTypePicker(false); }}>
                <Text style={s.pickerText}>{t}</Text>
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
  infoBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary, borderRadius: 12, padding: 12, marginHorizontal: 14, marginTop: 14 },
  infoText: { flex: 1, fontSize: 12, color: C.primary, lineHeight: 17 },
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
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardType: { fontSize: 15, fontWeight: '700', color: C.text },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11.5, fontWeight: '700' },
  descText: { fontSize: 13, color: C.text, lineHeight: 19 },
  resolutionBox: { backgroundColor: C.bg, borderRadius: 12, padding: 10, gap: 3 },
  resolutionLabel: { fontSize: 11, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  resolutionText: { fontSize: 12.5, color: C.text, lineHeight: 18 },
  appliedAt: { fontSize: 11, color: '#94A3B8' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, maxHeight: '90%' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: C.text },
  closeBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  formGroup: { marginBottom: 14 },
  formLabel: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 7 },
  input: { borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: C.text, backgroundColor: '#FAFAFA' },
  textarea: { height: 120, textAlignVertical: 'top' },
  select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, backgroundColor: '#FAFAFA' },
  selectText: { fontSize: 14, color: C.text, fontWeight: '500' },
  modalFooter: { flexDirection: 'row', gap: 12, marginTop: 8, paddingBottom: 12 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: C.muted },
  submitBtn: { flex: 1, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 10, elevation: 5 },
  submitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  pickerCard: { alignSelf: 'center', backgroundColor: C.surface, borderRadius: 24, padding: 20, width: '85%', maxWidth: 340, marginTop: 'auto', marginBottom: 'auto', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 24, elevation: 12 },
  pickerTitle: { fontSize: 16, fontWeight: '800', color: C.text, marginBottom: 14 },
  pickerItem: { paddingVertical: 12, paddingHorizontal: 10, borderRadius: 12 },
  pickerText: { fontSize: 14, color: C.text },
});
