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
import { TAX_CATEGORIES, listMyDeclarations, saveDeclaration, deleteDeclaration } from '@/services/taxService';
import { showToast } from '@/components/Toast';
import { fmt, fmtDate, currentFinancialYear } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Declared: { bg: C.warningBg, color: C.warning },
  'Proof Submitted': { bg: C.primaryBg, color: C.primary },
  Verified: { bg: C.successBg, color: C.success },
  Rejected: { bg: C.dangerBg, color: C.danger },
};

const EMPTY_FORM = { category: TAX_CATEGORIES[0], sub_category: '', declared_amount: '', proof_url: '' };
const fy = currentFinancialYear();

export default function TaxDeclarationScreen() {
  const router = useRouter();
  const { profile, tenant } = useAuth();
  const [declarations, setDeclarations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCatPicker, setShowCatPicker] = useState(false);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await listMyDeclarations(profile.id, fy);
    if (error) showToast(error.message || 'Could not load declarations.', 'error');
    else setDeclarations(data);
  }, [profile]);

  useFocusEffect(useCallback(() => { setLoading(true); fetchData().finally(() => setLoading(false)); }, [fetchData]));

  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const openModal = (row?: any) => {
    if (row) {
      setEditId(row.id);
      setForm({ category: row.category, sub_category: row.sub_category || '', declared_amount: String(row.declared_amount || ''), proof_url: row.proof_url || '' });
    } else {
      setEditId(null);
      setForm({ ...EMPTY_FORM });
    }
    setShowModal(true);
  };

  const total = declarations.reduce((sum, d) => sum + (Number(d.declared_amount) || 0), 0);

  const handleSubmit = async () => {
    if (!tenant || !profile) { showToast('Account setup incomplete.', 'error'); return; }
    if (!(Number(form.declared_amount) > 0)) { showToast('Enter a declared amount greater than 0.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await saveDeclaration(tenant.id, profile.id, { ...form, financial_year: fy }, editId);
      if (error) throw error;
      showToast(editId ? 'Declaration updated!' : 'Declaration saved!', 'success');
      setShowModal(false);
      fetchData();
    } catch (err: any) {
      showToast('Failed: ' + (err.message || 'Something went wrong'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await deleteDeclaration(id);
    if (error) showToast(error.message || 'Failed to delete.', 'error');
    else { showToast('Declaration deleted.', 'success'); fetchData(); }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Tax Declaration</Text>
          <Text style={s.subtitle}>FY {fy}</Text>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={() => openModal()} activeOpacity={0.85}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={s.addBtnText}>New</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}>
        {!loading && declarations.length > 0 && (
          <View style={s.totalCard}>
            <Text style={s.totalLabel}>Total declared</Text>
            <Text style={s.totalVal}>{fmt(total)}</Text>
          </View>
        )}
        {loading ? (
          <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>
        ) : declarations.length === 0 ? (
          <View style={s.emptyCard}>
            <View style={s.emptyIconWrap}><Ionicons name="document-text-outline" size={32} color={C.primary} /></View>
            <Text style={s.emptyTitle}>No declarations yet</Text>
            <Text style={s.emptyText}>Declare your tax-saving investments for FY {fy}.</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={() => openModal()}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={s.emptyBtnText}>New Declaration</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.list}>
            {declarations.map((d) => {
              const ss = STATUS_STYLE[d.status] || STATUS_STYLE.Declared;
              const editable = d.status === 'Declared';
              return (
                <View key={d.id} style={s.card}>
                  <View style={[s.cardStripe, { backgroundColor: ss.color }]} />
                  <View style={s.cardContent}>
                    <View style={s.cardTop}>
                      <Text style={s.cardCategory}>{d.category}</Text>
                      <View style={[s.statusPill, { backgroundColor: ss.bg }]}>
                        <View style={[s.statusDot, { backgroundColor: ss.color }]} />
                        <Text style={[s.statusText, { color: ss.color }]}>{d.status}</Text>
                      </View>
                    </View>
                    {!!d.sub_category && <Text style={s.subCat}>{d.sub_category}</Text>}
                    <Text style={s.amount}>{fmt(d.declared_amount)}</Text>
                    <Text style={s.appliedAt}>Filed {fmtDate(d.created_at)}</Text>
                    {editable && (
                      <View style={s.actionsRow}>
                        <TouchableOpacity style={s.actionBtn} onPress={() => openModal(d)}>
                          <Ionicons name="pencil-outline" size={13} color={C.primary} />
                          <Text style={s.actionBtnText}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.actionBtn} onPress={() => handleDelete(d.id)}>
                          <Ionicons name="trash-outline" size={13} color={C.danger} />
                          <Text style={[s.actionBtnText, { color: C.danger }]}>Delete</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal visible={showModal && !showCatPicker} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{editId ? 'Edit Declaration' : 'New Declaration'}</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} style={s.closeBtn}>
                <Ionicons name="close" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Category</Text>
                <TouchableOpacity style={s.select} onPress={() => setShowCatPicker(true)} activeOpacity={0.8}>
                  <Text style={s.selectText}>{form.category}</Text>
                  <Ionicons name="chevron-down" size={16} color={C.muted} />
                </TouchableOpacity>
              </View>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Sub-category (optional)</Text>
                <TextInput style={s.input} value={form.sub_category} placeholder="e.g. PPF, LIC, ELSS" placeholderTextColor={C.muted}
                  onChangeText={(v) => setForm((f) => ({ ...f, sub_category: v }))} />
              </View>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Declared Amount</Text>
                <TextInput style={s.input} value={form.declared_amount} placeholder="0" placeholderTextColor={C.muted}
                  keyboardType="numeric" onChangeText={(v) => setForm((f) => ({ ...f, declared_amount: v }))} />
              </View>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Proof link (optional)</Text>
                <TextInput style={s.input} value={form.proof_url} placeholder="Link to uploaded proof document" placeholderTextColor={C.muted}
                  autoCapitalize="none" onChangeText={(v) => setForm((f) => ({ ...f, proof_url: v }))} />
              </View>
              <View style={s.modalFooter}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setShowModal(false)}>
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.submitBtn, saving && { opacity: 0.6 }]} onPress={handleSubmit} disabled={saving} activeOpacity={0.85}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.submitText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showCatPicker} animationType="fade" transparent>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowCatPicker(false)}>
          <TouchableOpacity activeOpacity={1} style={s.pickerCard} onPress={() => {}}>
            <Text style={s.pickerTitle}>Category</Text>
            {TAX_CATEGORIES.map((cat) => (
              <TouchableOpacity key={cat} style={s.pickerItem}
                onPress={() => { setForm((f) => ({ ...f, category: cat })); setShowCatPicker(false); }}>
                <Text style={s.pickerText}>{cat}</Text>
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
  totalCard: { margin: 14, marginBottom: 0, backgroundColor: C.surface, borderRadius: 18, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  totalLabel: { fontSize: 13, color: C.muted, fontWeight: '600' },
  totalVal: { fontSize: 20, fontWeight: '800', color: C.text },
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
  cardContent: { flex: 1, padding: 14, gap: 6 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardCategory: { fontSize: 15, fontWeight: '700', color: C.text },
  subCat: { fontSize: 12.5, color: C.muted },
  amount: { fontSize: 18, fontWeight: '800', color: C.text },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11.5, fontWeight: '700' },
  appliedAt: { fontSize: 11, color: '#94A3B8' },
  actionsRow: { flexDirection: 'row', gap: 16, marginTop: 2 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionBtnText: { fontSize: 12, color: C.primary, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, maxHeight: '90%' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: C.text },
  closeBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  formGroup: { marginBottom: 14 },
  formLabel: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 7 },
  input: { borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: C.text, backgroundColor: '#FAFAFA' },
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
