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
import {
  listAllReferrals, listInterviewsForReferral, listMyInterviews,
  scheduleInterview, updateInterviewStatus, submitInterviewFeedback,
} from '@/services/hiringService';
import { listColleagues } from '@/services/feedbackService';
import { showToast } from '@/components/Toast';
import { fmtDateTime } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

const SKILLS = ['communication', 'technical', 'culture_fit'];
const SKILL_LABELS: Record<string, string> = { communication: 'Communication', technical: 'Technical', culture_fit: 'Culture Fit' };
const RECOMMENDATIONS = ['Strong Yes', 'Yes', 'Neutral', 'No', 'Strong No'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const fullName = (p: any) => [p?.first_name, p?.middle_name, p?.last_name].filter(Boolean).join(' ').toUpperCase() || 'UNKNOWN';

export default function InterviewsScreen() {
  const router = useRouter();
  const { profile, tenant } = useAuth();
  const canManage = profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'superadmin';

  const [tab, setTab] = useState<'pipeline' | 'mine'>(canManage ? 'pipeline' : 'mine');
  const [referrals, setReferrals] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [myInterviews, setMyInterviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [scheduleFor, setScheduleFor] = useState<any>(null);
  const [scheduleForm, setScheduleForm] = useState({ round_name: 'Round 1', interviewer_id: '', date: '', time: '' });
  const [showInterviewerPicker, setShowInterviewerPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const [viewFor, setViewFor] = useState<any>(null);
  const [interviewList, setInterviewList] = useState<any[]>([]);

  const [feedbackFor, setFeedbackFor] = useState<any>(null);
  const [feedbackForm, setFeedbackForm] = useState<{ ratings: Record<string, number>; recommendation: string; comments: string }>({ ratings: {}, recommendation: 'Neutral', comments: '' });
  const [showRecPicker, setShowRecPicker] = useState(false);

  const fetchData = useCallback(async () => {
    if (!tenant || !profile) return;
    if (canManage) {
      const [refRes, empRes] = await Promise.all([listAllReferrals(tenant.id), listColleagues(tenant.id, profile.id)]);
      setReferrals(refRes.data);
      setEmployees(empRes.data);
    }
    const { data } = await listMyInterviews(profile.id);
    setMyInterviews(data);
  }, [tenant, profile, canManage]);

  useFocusEffect(useCallback(() => { setLoading(true); fetchData().finally(() => setLoading(false)); }, [fetchData]));
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const openSchedule = (referral: any) => {
    setScheduleFor(referral);
    setScheduleForm({ round_name: 'Round 1', interviewer_id: '', date: '', time: '' });
  };

  const doSchedule = async () => {
    if (!scheduleForm.interviewer_id) { showToast('Select an interviewer.', 'error'); return; }
    let scheduledAt: string | null = null;
    if (scheduleForm.date || scheduleForm.time) {
      if (!DATE_RE.test(scheduleForm.date) || !TIME_RE.test(scheduleForm.time)) {
        showToast('Enter date as YYYY-MM-DD and time as HH:MM, or leave both blank.', 'error');
        return;
      }
      scheduledAt = new Date(`${scheduleForm.date}T${scheduleForm.time}:00`).toISOString();
    }
    setSaving(true);
    try {
      const { error } = await scheduleInterview(tenant!.id, profile!.id, {
        referral_id: scheduleFor.id, round_name: scheduleForm.round_name, interviewer_id: scheduleForm.interviewer_id, scheduled_at: scheduledAt,
      });
      if (error) throw error;
      showToast('Interview scheduled.', 'success');
      setScheduleFor(null);
      fetchData();
    } catch (err: any) {
      showToast('Failed: ' + (err.message || 'Something went wrong'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const openView = async (referral: any) => {
    setViewFor(referral);
    const { data } = await listInterviewsForReferral(referral.id);
    setInterviewList(data);
  };

  const openFeedback = (interview: any) => {
    setFeedbackFor(interview);
    const mine = (interview.feedback || []).find((f: any) => f.interviewer_id === profile!.id);
    setFeedbackForm(mine ? { ratings: mine.ratings || {}, recommendation: mine.recommendation, comments: mine.comments || '' } : { ratings: {}, recommendation: 'Neutral', comments: '' });
  };

  const doSubmitFeedback = async () => {
    setSaving(true);
    try {
      const { error } = await submitInterviewFeedback(feedbackFor.id, profile!.id, feedbackForm);
      if (error) throw error;
      await updateInterviewStatus(feedbackFor.id, 'Completed');
      showToast('Feedback submitted.', 'success');
      setFeedbackFor(null);
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
          <Text style={s.title}>Interviews</Text>
          <Text style={s.subtitle}>Schedule rounds & give feedback</Text>
        </View>
      </View>

      {canManage && (
        <View style={s.segmentRow}>
          <TouchableOpacity style={[s.segment, tab === 'pipeline' && s.segmentActive]} onPress={() => setTab('pipeline')}>
            <Text style={[s.segmentText, tab === 'pipeline' && s.segmentTextActive]}>Pipeline</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.segment, tab === 'mine' && s.segmentActive]} onPress={() => setTab('mine')}>
            <Text style={[s.segmentText, tab === 'mine' && s.segmentTextActive]}>My Interviews</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}>
        {loading ? (
          <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>
        ) : tab === 'pipeline' ? (
          referrals.length === 0 ? (
            <View style={s.emptyCard}>
              <View style={s.emptyIconWrap}><Ionicons name="people-circle-outline" size={32} color={C.primary} /></View>
              <Text style={s.emptyTitle}>No candidates yet</Text>
              <Text style={s.emptyText}>Referrals submitted by employees will show up here.</Text>
            </View>
          ) : (
            <View style={s.list}>
              {referrals.map((r) => (
                <View key={r.id} style={s.card}>
                  <View style={s.cardTop}>
                    <Text style={s.cardName}>{r.candidate_name}</Text>
                    <View style={s.statusPill}><Text style={s.statusText}>{r.status}</Text></View>
                  </View>
                  <Text style={s.cardMeta}>{r.job_postings?.title || 'Position not specified'}</Text>
                  <View style={s.cardActions}>
                    <TouchableOpacity style={s.actionBtn} onPress={() => openSchedule(r)}>
                      <Text style={s.actionBtnText}>Schedule</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.actionBtn} onPress={() => openView(r)}>
                      <Text style={s.actionBtnText}>View Interviews</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )
        ) : myInterviews.length === 0 ? (
          <View style={s.emptyCard}>
            <View style={s.emptyIconWrap}><Ionicons name="calendar-outline" size={32} color={C.primary} /></View>
            <Text style={s.emptyTitle}>No interviews assigned</Text>
            <Text style={s.emptyText}>Interviews scheduled with you as interviewer will show up here.</Text>
          </View>
        ) : (
          <View style={s.list}>
            {myInterviews.map((i) => (
              <View key={i.id} style={s.card}>
                <View style={s.cardTop}>
                  <Text style={s.cardName}>{i.referral?.candidate_name || 'Candidate'}</Text>
                  <View style={s.statusPill}><Text style={s.statusText}>{i.status}</Text></View>
                </View>
                <Text style={s.cardMeta}>{i.referral?.job_postings?.title || 'Position not specified'} · {i.round_name}</Text>
                <Text style={s.cardMeta}>{i.scheduled_at ? fmtDateTime(i.scheduled_at) : 'Not yet scheduled'}</Text>
                <View style={s.cardActions}>
                  <TouchableOpacity style={s.actionBtn} onPress={() => openFeedback(i)}>
                    <Text style={s.actionBtnText}>{i.status === 'Completed' ? 'View/Edit Feedback' : 'Give Feedback'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Schedule modal */}
      <Modal visible={!!scheduleFor && !showInterviewerPicker} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Schedule Interview — {scheduleFor?.candidate_name}</Text>
              <TouchableOpacity onPress={() => setScheduleFor(null)} style={s.closeBtn}>
                <Ionicons name="close" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Round Name</Text>
                <TextInput style={s.input} value={scheduleForm.round_name} onChangeText={(v) => setScheduleForm((f) => ({ ...f, round_name: v }))} />
              </View>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Interviewer *</Text>
                <TouchableOpacity style={s.select} onPress={() => setShowInterviewerPicker(true)} activeOpacity={0.8}>
                  <Text style={s.selectText}>
                    {scheduleForm.interviewer_id ? fullName(employees.find((e) => e.id === scheduleForm.interviewer_id)) : 'Select Interviewer'}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={C.muted} />
                </TouchableOpacity>
              </View>
              <View style={s.row}>
                <View style={[s.formGroup, { flex: 1 }]}>
                  <Text style={s.formLabel}>Date</Text>
                  <TextInput style={s.input} value={scheduleForm.date} placeholder="YYYY-MM-DD" placeholderTextColor={C.muted}
                    keyboardType="numeric" maxLength={10} onChangeText={(v) => setScheduleForm((f) => ({ ...f, date: v }))} />
                </View>
                <View style={[s.formGroup, { flex: 1 }]}>
                  <Text style={s.formLabel}>Time</Text>
                  <TextInput style={s.input} value={scheduleForm.time} placeholder="HH:MM" placeholderTextColor={C.muted}
                    keyboardType="numeric" maxLength={5} onChangeText={(v) => setScheduleForm((f) => ({ ...f, time: v }))} />
                </View>
              </View>
              <View style={s.modalFooter}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setScheduleFor(null)}>
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.submitBtn, saving && { opacity: 0.6 }]} onPress={doSchedule} disabled={saving} activeOpacity={0.85}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.submitText}>Schedule</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showInterviewerPicker} animationType="fade" transparent>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowInterviewerPicker(false)}>
          <TouchableOpacity activeOpacity={1} style={s.pickerCard} onPress={() => {}}>
            <Text style={s.pickerTitle}>Interviewer</Text>
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {employees.map((e) => (
                <TouchableOpacity key={e.id} style={s.pickerItem}
                  onPress={() => { setScheduleForm((f) => ({ ...f, interviewer_id: e.id })); setShowInterviewerPicker(false); }}>
                  <Text style={s.pickerText}>{fullName(e)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* View interviews modal */}
      <Modal visible={!!viewFor} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Interviews — {viewFor?.candidate_name}</Text>
              <TouchableOpacity onPress={() => setViewFor(null)} style={s.closeBtn}>
                <Ionicons name="close" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {interviewList.length === 0 ? (
                <Text style={{ color: C.muted, fontSize: 13, textAlign: 'center', paddingVertical: 16 }}>No interviews scheduled yet.</Text>
              ) : interviewList.map((i) => (
                <View key={i.id} style={s.viewRow}>
                  <View style={s.cardTop}>
                    <Text style={s.cardName}>{i.round_name}</Text>
                    <View style={s.statusPill}><Text style={s.statusText}>{i.status}</Text></View>
                  </View>
                  <Text style={s.cardMeta}>{fullName(i.interviewer)} · {i.scheduled_at ? fmtDateTime(i.scheduled_at) : 'not yet scheduled'}</Text>
                  {(i.feedback || []).map((f: any) => (
                    <Text key={f.id} style={s.feedbackLine}>{f.recommendation} — {f.comments}</Text>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Feedback modal */}
      <Modal visible={!!feedbackFor && !showRecPicker} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Interview Feedback</Text>
              <TouchableOpacity onPress={() => setFeedbackFor(null)} style={s.closeBtn}>
                <Ionicons name="close" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {SKILLS.map((skill) => (
                <View style={s.formGroup} key={skill}>
                  <Text style={s.formLabel}>{SKILL_LABELS[skill]} (1–5)</Text>
                  <TextInput style={s.input} keyboardType="number-pad" maxLength={1}
                    value={feedbackForm.ratings[skill] ? String(feedbackForm.ratings[skill]) : ''}
                    onChangeText={(v) => setFeedbackForm((f) => ({ ...f, ratings: { ...f.ratings, [skill]: Math.min(5, parseInt(v) || 0) } }))} />
                </View>
              ))}
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Recommendation</Text>
                <TouchableOpacity style={s.select} onPress={() => setShowRecPicker(true)} activeOpacity={0.8}>
                  <Text style={s.selectText}>{feedbackForm.recommendation}</Text>
                  <Ionicons name="chevron-down" size={16} color={C.muted} />
                </TouchableOpacity>
              </View>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Comments</Text>
                <TextInput style={[s.input, s.textarea]} value={feedbackForm.comments} multiline numberOfLines={4}
                  onChangeText={(v) => setFeedbackForm((f) => ({ ...f, comments: v }))} />
              </View>
              <View style={s.modalFooter}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setFeedbackFor(null)}>
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.submitBtn, saving && { opacity: 0.6 }]} onPress={doSubmitFeedback} disabled={saving} activeOpacity={0.85}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.submitText}>Submit</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showRecPicker} animationType="fade" transparent>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowRecPicker(false)}>
          <TouchableOpacity activeOpacity={1} style={s.pickerCard} onPress={() => {}}>
            <Text style={s.pickerTitle}>Recommendation</Text>
            {RECOMMENDATIONS.map((r) => (
              <TouchableOpacity key={r} style={s.pickerItem}
                onPress={() => { setFeedbackForm((f) => ({ ...f, recommendation: r })); setShowRecPicker(false); }}>
                <Text style={s.pickerText}>{r}</Text>
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
  segmentRow: { flexDirection: 'row', gap: 8, backgroundColor: C.dark, paddingHorizontal: 16, paddingBottom: 14 },
  segment: { flex: 1, paddingVertical: 9, borderRadius: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  segmentActive: { backgroundColor: C.primary },
  segmentText: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.6)' },
  segmentTextActive: { color: '#fff' },
  loadingBox: { padding: 60, alignItems: 'center' },
  emptyCard: { margin: 14, backgroundColor: C.surface, borderRadius: 20, padding: 40, alignItems: 'center', gap: 10, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  emptyIconWrap: { width: 68, height: 68, borderRadius: 22, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  emptyText: { fontSize: 13, color: C.muted, textAlign: 'center' },
  list: { padding: 14, gap: 12 },
  card: { backgroundColor: C.surface, borderRadius: 18, padding: 14, gap: 6, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardName: { fontSize: 15, fontWeight: '700', color: C.text, flexShrink: 1 },
  cardMeta: { fontSize: 12.5, color: C.muted },
  statusPill: { backgroundColor: C.primaryBg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 11.5, fontWeight: '700', color: C.primary },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  actionBtn: { borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  actionBtnText: { fontSize: 12.5, fontWeight: '700', color: C.primary },
  viewRow: { borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 12, gap: 4 },
  feedbackLine: { fontSize: 12, color: C.text, marginTop: 2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, maxHeight: '90%' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: C.text, flex: 1, marginRight: 8 },
  closeBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  formGroup: { marginBottom: 14 },
  formLabel: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 7 },
  input: { borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: C.text, backgroundColor: '#FAFAFA' },
  textarea: { height: 100, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 12 },
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
