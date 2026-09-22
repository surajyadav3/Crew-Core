import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '@/context/AuthContext';
import { listJobPostings, listMyReferrals, createReferral, uploadResume } from '@/services/hiringService';
import { showToast } from '@/components/Toast';
import { fmt, fmtDate } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Submitted: { bg: C.warningBg, color: C.warning },
  'Under Review': { bg: C.primaryBg, color: C.primary },
  Shortlisted: { bg: C.tealBg, color: C.teal },
  Hired: { bg: C.successBg, color: C.success },
  'Not Selected': { bg: C.dangerBg, color: C.danger },
};

const EMPTY_FORM = { candidate_name: '', candidate_email: '', candidate_phone: '', relationship: '', notes: '' };

type TabKey = 'postings' | 'referrals';

export default function ReferScreen() {
  const router = useRouter();
  const { profile, tenant } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('postings');
  const [postings, setPostings] = useState<any[]>([]);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [activePosting, setActivePosting] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [resume, setResume] = useState<{ uri: string; name: string; mimeType?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!profile || !tenant) return;
    const [pRes, rRes] = await Promise.all([listJobPostings(tenant.id), listMyReferrals(profile.id)]);
    if (pRes.error) showToast(pRes.error.message || 'Could not load job postings.', 'error');
    else setPostings(pRes.data.filter((p: any) => p.status === 'Open'));
    if (rRes.error) showToast(rRes.error.message || 'Could not load your referrals.', 'error');
    else setReferrals(rRes.data);
  }, [profile, tenant]);

  useFocusEffect(useCallback(() => { setLoading(true); fetchData().finally(() => setLoading(false)); }, [fetchData]));

  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const openModal = (posting: any) => {
    setActivePosting(posting);
    setForm({ ...EMPTY_FORM });
    setResume(null);
    setShowModal(true);
  };

  const pickResume = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    setResume({ uri: a.uri, name: a.name, mimeType: a.mimeType });
  };

  const handleSubmit = async () => {
    if (!tenant || !profile || !activePosting) { showToast('Something went wrong.', 'error'); return; }
    if (!form.candidate_name.trim()) { showToast("Please enter the candidate's name.", 'error'); return; }
    setSaving(true);
    try {
      let resume_file_path = '';
      if (resume) {
        const { path, error } = await uploadResume(tenant.id, profile.id, resume.uri, resume.name);
        if (error) throw error;
        resume_file_path = path || '';
      }
      const { error } = await createReferral({
        tenant_id: tenant.id, job_posting_id: activePosting.id, referred_by: profile.id,
        candidate_name: form.candidate_name.trim(), candidate_email: form.candidate_email.trim(),
        candidate_phone: form.candidate_phone.trim(), relationship: form.relationship.trim(), notes: form.notes.trim(),
        resume_file_path,
      });
      if (error) throw error;
      showToast('Referral submitted — thank you!', 'success');
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
          <Text style={s.title}>Refer a Friend</Text>
          <Text style={s.subtitle}>Know someone great? Refer them here</Text>
        </View>
      </View>

      <View style={s.tabContainer}>
        {(['postings', 'referrals'] as const).map((key) => {
          const icons = { postings: 'briefcase-outline' as const, referrals: 'people-outline' as const };
          const labels = { postings: 'Open Roles', referrals: 'My Referrals' };
          const isActive = activeTab === key;
          return (
            <TouchableOpacity key={key} style={[s.tabItem, isActive && s.tabItemActive]} onPress={() => setActiveTab(key)} activeOpacity={0.8}>
              <Ionicons name={icons[key]} size={15} color={isActive ? C.primary : C.muted} />
              <Text style={[s.tabLabel, isActive && s.tabLabelActive]}>{labels[key]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}>
        {loading ? (
          <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>
        ) : activeTab === 'postings' ? (
          postings.length === 0 ? (
            <View style={s.emptyCard}>
              <View style={s.emptyIconWrap}><Ionicons name="briefcase-outline" size={32} color={C.primary} /></View>
              <Text style={s.emptyTitle}>No open roles right now</Text>
              <Text style={s.emptyText}>Check back later for new openings to refer someone for.</Text>
            </View>
          ) : (
            <View style={s.list}>
              {postings.map((p) => (
                <View key={p.id} style={s.postingCard}>
                  <View style={s.postingTop}>
                    <Text style={s.postingTitle}>{p.title}</Text>
                    {p.referral_bonus > 0 && (
                      <View style={s.bonusPill}><Text style={s.bonusText}>{fmt(p.referral_bonus)} bonus</Text></View>
                    )}
                  </View>
                  <Text style={s.postingMeta}>{[p.department, p.location, p.employment_type].filter(Boolean).join(' · ')}</Text>
                  {!!p.experience_required && <Text style={s.postingMeta}>{p.experience_required} experience</Text>}
                  {!!p.description && <Text style={s.postingDesc} numberOfLines={3}>{p.description}</Text>}
                  <TouchableOpacity style={s.referBtn} onPress={() => openModal(p)} activeOpacity={0.85}>
                    <Ionicons name="person-add-outline" size={15} color="#fff" />
                    <Text style={s.referBtnText}>Refer Someone</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )
        ) : referrals.length === 0 ? (
          <View style={s.emptyCard}>
            <View style={s.emptyIconWrap}><Ionicons name="people-outline" size={32} color={C.primary} /></View>
            <Text style={s.emptyTitle}>No referrals yet</Text>
            <Text style={s.emptyText}>Refer a friend for an open role and track their status here.</Text>
          </View>
        ) : (
          <View style={s.list}>
            {referrals.map((r) => {
              const ss = STATUS_STYLE[r.status] || STATUS_STYLE.Submitted;
              return (
                <View key={r.id} style={s.card}>
                  <View style={[s.cardStripe, { backgroundColor: ss.color }]} />
                  <View style={s.cardContent}>
                    <View style={s.cardTop}>
                      <Text style={s.cardName}>{r.candidate_name}</Text>
                      <View style={[s.statusPill, { backgroundColor: ss.bg }]}>
                        <View style={[s.statusDot, { backgroundColor: ss.color }]} />
                        <Text style={[s.statusText, { color: ss.color }]}>{r.status}</Text>
                      </View>
                    </View>
                    <Text style={s.postingRefText}>{r.job_postings?.title || 'Role'}</Text>
                    {!!r.hr_notes && (
                      <View style={s.resolutionBox}>
                        <Text style={s.resolutionLabel}>HR's note</Text>
                        <Text style={s.resolutionText}>{r.hr_notes}</Text>
                      </View>
                    )}
                    <Text style={s.appliedAt}>Referred {fmtDate(r.created_at)}</Text>
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
              <Text style={s.modalTitle} numberOfLines={1}>Refer for {activePosting?.title}</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} style={s.closeBtn}>
                <Ionicons name="close" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Candidate Name</Text>
                <TextInput style={s.input} value={form.candidate_name} placeholder="Full name" placeholderTextColor={C.muted}
                  onChangeText={(v) => setForm((f) => ({ ...f, candidate_name: v }))} />
              </View>
              <View style={s.row}>
                <View style={[s.formGroup, { flex: 1 }]}>
                  <Text style={s.formLabel}>Email</Text>
                  <TextInput style={s.input} value={form.candidate_email} placeholder="candidate@email.com" placeholderTextColor={C.muted}
                    keyboardType="email-address" autoCapitalize="none" onChangeText={(v) => setForm((f) => ({ ...f, candidate_email: v }))} />
                </View>
                <View style={[s.formGroup, { flex: 1 }]}>
                  <Text style={s.formLabel}>Phone</Text>
                  <TextInput style={s.input} value={form.candidate_phone} placeholder="10-digit number" placeholderTextColor={C.muted}
                    keyboardType="phone-pad" onChangeText={(v) => setForm((f) => ({ ...f, candidate_phone: v }))} />
                </View>
              </View>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Your Relationship</Text>
                <TextInput style={s.input} value={form.relationship} placeholder="e.g. Former colleague, friend" placeholderTextColor={C.muted}
                  onChangeText={(v) => setForm((f) => ({ ...f, relationship: v }))} />
              </View>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Notes (optional)</Text>
                <TextInput style={[s.input, s.textarea]} value={form.notes} multiline numberOfLines={3}
                  placeholder="Why would they be a good fit?" placeholderTextColor={C.muted}
                  onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))} />
              </View>
              <TouchableOpacity style={s.receiptBtn} onPress={pickResume}>
                <Ionicons name="document-attach-outline" size={16} color={C.primary} />
                <Text style={s.receiptBtnText} numberOfLines={1}>{resume ? resume.name : 'Attach resume (PDF or Word)'}</Text>
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
  tabContainer: { flexDirection: 'row', backgroundColor: C.dark, paddingHorizontal: 14, paddingBottom: 14, gap: 8 },
  tabItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  tabItemActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  tabLabel: { fontSize: 13, fontWeight: '600', color: C.muted },
  tabLabelActive: { color: C.primary },
  loadingBox: { padding: 60, alignItems: 'center' },
  emptyCard: { margin: 14, backgroundColor: C.surface, borderRadius: 20, padding: 40, alignItems: 'center', gap: 10, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  emptyIconWrap: { width: 68, height: 68, borderRadius: 22, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  emptyText: { fontSize: 13, color: C.muted, textAlign: 'center' },
  list: { padding: 14, gap: 12 },
  postingCard: { backgroundColor: C.surface, borderRadius: 18, padding: 16, gap: 6, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  postingTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  postingTitle: { fontSize: 16, fontWeight: '800', color: C.text, flex: 1 },
  bonusPill: { backgroundColor: C.successBg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  bonusText: { fontSize: 11.5, fontWeight: '700', color: C.success },
  postingMeta: { fontSize: 12.5, color: C.muted },
  postingDesc: { fontSize: 12.5, color: C.text, lineHeight: 18, marginTop: 2 },
  referBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 12, marginTop: 8 },
  referBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  card: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: 18, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  cardStripe: { width: 5 },
  cardContent: { flex: 1, padding: 14, gap: 6 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardName: { fontSize: 15, fontWeight: '700', color: C.text },
  postingRefText: { fontSize: 12.5, color: C.muted },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11.5, fontWeight: '700' },
  resolutionBox: { backgroundColor: C.bg, borderRadius: 12, padding: 10, gap: 3 },
  resolutionLabel: { fontSize: 11, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  resolutionText: { fontSize: 12.5, color: C.text, lineHeight: 18 },
  appliedAt: { fontSize: 11, color: '#94A3B8' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, maxHeight: '90%' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 10 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: C.text, flex: 1 },
  closeBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  formGroup: { marginBottom: 14 },
  formLabel: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 7 },
  input: { borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: C.text, backgroundColor: '#FAFAFA' },
  textarea: { height: 72, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10 },
  receiptBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: C.primary, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12, marginBottom: 14 },
  receiptBtnText: { fontSize: 12.5, color: C.primary, fontWeight: '600', flex: 1 },
  modalFooter: { flexDirection: 'row', gap: 12, marginTop: 4, paddingBottom: 12 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: C.muted },
  submitBtn: { flex: 1, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 10, elevation: 5 },
  submitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
