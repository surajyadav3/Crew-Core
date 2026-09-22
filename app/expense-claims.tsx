import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@/context/AuthContext';
import {
  EXPENSE_CATEGORIES, RECEIPT_BUCKET, listMyExpenseClaims, createExpenseClaim, deleteExpenseClaim,
} from '@/services/expenseService';
import { uploadToBucket } from '@/lib/uploadFile';
import { showToast } from '@/components/Toast';
import { fmt, fmtDate } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Pending: { bg: C.warningBg, color: C.warning },
  Approved: { bg: C.successBg, color: C.success },
  Rejected: { bg: C.dangerBg, color: C.danger },
  Paid: { bg: C.primaryBg, color: C.primary },
};

type Item = { key: string; category: string; amount: string; description: string; imageUri?: string };
const newItem = (): Item => ({ key: String(Date.now() + Math.random()), category: EXPENSE_CATEGORIES[0], amount: '', description: '' });

export default function ExpenseClaimsScreen() {
  const router = useRouter();
  const { profile, tenant } = useAuth();
  const [claims, setClaims] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [items, setItems] = useState<Item[]>([newItem()]);
  const [saving, setSaving] = useState(false);
  const [showCatPicker, setShowCatPicker] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await listMyExpenseClaims(profile.id);
    if (error) showToast(error.message || 'Could not load claims.', 'error');
    else setClaims(data);
  }, [profile]);

  useFocusEffect(useCallback(() => { setLoading(true); fetchData().finally(() => setLoading(false)); }, [fetchData]));

  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const openModal = () => { setItems([newItem()]); setShowModal(true); };

  const pickReceipt = async (key: string) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { showToast('Photo library permission is required.', 'error'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (result.canceled || !result.assets?.[0]) return;
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, imageUri: result.assets[0].uri } : it)));
  };

  const totalAmount = items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

  const handleSubmit = async () => {
    if (!tenant || !profile) { showToast('Account setup incomplete.', 'error'); return; }
    const invalid = items.some((i) => !i.category || !(Number(i.amount) > 0));
    if (invalid) { showToast('Every item needs a category and an amount greater than 0.', 'error'); return; }
    setSaving(true);
    try {
      const uploaded = await Promise.all(items.map(async (it) => {
        let receipt_path = '';
        if (it.imageUri) {
          const fileName = it.imageUri.split('/').pop() || `receipt-${it.key}.jpg`;
          const { path, error } = await uploadToBucket(RECEIPT_BUCKET, tenant.id, profile.id, it.imageUri, fileName, 'image/jpeg');
          if (error) throw error;
          receipt_path = path || '';
        }
        return { category: it.category, amount: it.amount, description: it.description, receipt_path };
      }));
      const { error } = await createExpenseClaim(tenant.id, profile.id, null, uploaded);
      if (error) throw error;
      showToast('Expense claim submitted!', 'success');
      setShowModal(false);
      fetchData();
    } catch (err: any) {
      showToast('Failed: ' + (err.message || 'Something went wrong'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await deleteExpenseClaim(id);
    if (error) showToast(error.message || 'Failed to delete.', 'error');
    else { showToast('Claim deleted.', 'success'); fetchData(); }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Expense Claims</Text>
          <Text style={s.subtitle}>Submit and track reimbursements</Text>
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
        ) : claims.length === 0 ? (
          <View style={s.emptyCard}>
            <View style={s.emptyIconWrap}><Ionicons name="receipt-outline" size={32} color={C.primary} /></View>
            <Text style={s.emptyTitle}>No expense claims yet</Text>
            <Text style={s.emptyText}>Submit a claim for travel, meals, or other work expenses.</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={openModal}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={s.emptyBtnText}>New Claim</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.list}>
            {claims.map((c) => {
              const ss = STATUS_STYLE[c.status] || STATUS_STYLE.Pending;
              return (
                <View key={c.id} style={s.card}>
                  <View style={[s.cardStripe, { backgroundColor: ss.color }]} />
                  <View style={s.cardContent}>
                    <View style={s.cardTop}>
                      <Text style={s.cardAmount}>{fmt(c.total_amount)}</Text>
                      <View style={[s.statusPill, { backgroundColor: ss.bg }]}>
                        <View style={[s.statusDot, { backgroundColor: ss.color }]} />
                        <Text style={[s.statusText, { color: ss.color }]}>{c.status}</Text>
                      </View>
                    </View>
                    <View style={s.chipsRow}>
                      {(c.items || []).map((it: any) => (
                        <View key={it.id} style={s.chip}><Text style={s.chipText}>{it.category}</Text></View>
                      ))}
                    </View>
                    <Text style={s.appliedAt}>Submitted {fmtDate(c.created_at)}</Text>
                    {c.status === 'Pending' && (
                      <TouchableOpacity style={s.deleteBtn} onPress={() => handleDelete(c.id)}>
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

      <Modal visible={showModal && !showCatPicker} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>New Expense Claim</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} style={s.closeBtn}>
                <Ionicons name="close" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {items.map((it, idx) => (
                <View key={it.key} style={s.itemCard}>
                  <View style={s.itemHeader}>
                    <Text style={s.itemLabel}>Item {idx + 1}</Text>
                    {items.length > 1 && (
                      <TouchableOpacity onPress={() => setItems((prev) => prev.filter((p) => p.key !== it.key))}>
                        <Ionicons name="close-circle" size={18} color={C.danger} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <TouchableOpacity style={s.select} onPress={() => setShowCatPicker(it.key)} activeOpacity={0.8}>
                    <Text style={s.selectText}>{it.category}</Text>
                    <Ionicons name="chevron-down" size={16} color={C.muted} />
                  </TouchableOpacity>
                  <TextInput
                    style={s.input} value={it.amount} keyboardType="numeric"
                    placeholder="Amount" placeholderTextColor={C.muted}
                    onChangeText={(v) => setItems((prev) => prev.map((p) => (p.key === it.key ? { ...p, amount: v } : p)))}
                  />
                  <TextInput
                    style={[s.input, s.textarea]} value={it.description} multiline numberOfLines={2}
                    placeholder="Description (optional)" placeholderTextColor={C.muted}
                    onChangeText={(v) => setItems((prev) => prev.map((p) => (p.key === it.key ? { ...p, description: v } : p)))}
                  />
                  <TouchableOpacity style={s.receiptBtn} onPress={() => pickReceipt(it.key)}>
                    {it.imageUri ? (
                      <Image source={{ uri: it.imageUri }} style={s.receiptThumb} />
                    ) : (
                      <Ionicons name="camera-outline" size={16} color={C.primary} />
                    )}
                    <Text style={s.receiptBtnText}>{it.imageUri ? 'Change receipt' : 'Attach receipt'}</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={s.addItemBtn} onPress={() => setItems((prev) => [...prev, newItem()])}>
                <Ionicons name="add" size={16} color={C.primary} />
                <Text style={s.addItemText}>Add another item</Text>
              </TouchableOpacity>
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Total</Text>
                <Text style={s.totalVal}>{fmt(totalAmount)}</Text>
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

      <Modal visible={!!showCatPicker} animationType="fade" transparent>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowCatPicker(null)}>
          <TouchableOpacity activeOpacity={1} style={s.pickerCard} onPress={() => {}}>
            <Text style={s.pickerTitle}>Category</Text>
            {EXPENSE_CATEGORIES.map((cat) => (
              <TouchableOpacity key={cat} style={s.pickerItem}
                onPress={() => {
                  setItems((prev) => prev.map((p) => (p.key === showCatPicker ? { ...p, category: cat } : p)));
                  setShowCatPicker(null);
                }}>
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
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, backgroundColor: C.dark,
  },
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
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardAmount: { fontSize: 18, fontWeight: '800', color: C.text },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11.5, fontWeight: '700' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: C.bg, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  chipText: { fontSize: 11.5, color: C.muted, fontWeight: '600' },
  appliedAt: { fontSize: 11, color: '#94A3B8' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 2 },
  deleteBtnText: { fontSize: 12, color: C.danger, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, maxHeight: '90%' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: C.text },
  closeBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  itemCard: { backgroundColor: C.bg, borderRadius: 16, padding: 14, marginBottom: 12, gap: 10 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemLabel: { fontSize: 12.5, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#FAFAFA' },
  selectText: { fontSize: 14, color: C.text, fontWeight: '500' },
  input: { borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: C.text, backgroundColor: '#FAFAFA' },
  textarea: { height: 64, textAlignVertical: 'top' },
  receiptBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 6 },
  receiptThumb: { width: 24, height: 24, borderRadius: 6 },
  receiptBtnText: { fontSize: 12.5, color: C.primary, fontWeight: '600' },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: C.primary, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 12, marginBottom: 14 },
  addItemText: { fontSize: 13.5, color: C.primary, fontWeight: '700' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, marginBottom: 6 },
  totalLabel: { fontSize: 14, color: C.muted, fontWeight: '600' },
  totalVal: { fontSize: 20, color: C.text, fontWeight: '800' },
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
