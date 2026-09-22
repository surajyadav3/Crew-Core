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
  fetchMySkillMap, listTrainingEvents, listMyEnrollments, enrollInEvent, submitTrainingFeedback,
} from '@/services/trainingService';
import { showToast } from '@/components/Toast';
import { fmtDate } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

const ENROLL_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Enrolled: { bg: C.primaryBg, color: C.primary },
  Attended: { bg: C.successBg, color: C.success },
  'No Show': { bg: C.dangerBg, color: C.danger },
  Cancelled: { bg: C.bg, color: C.muted },
};

type TabKey = 'skills' | 'programs';

export default function TrainingScreen() {
  const router = useRouter();
  const { profile, tenant } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('programs');
  const [skills, setSkills] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [myEnrollments, setMyEnrollments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<any>(null);
  const [rating, setRating] = useState(0);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!profile || !tenant) return;
    const [skillRes, eventRes, enrollRes] = await Promise.all([
      fetchMySkillMap(profile.id), listTrainingEvents(tenant.id), listMyEnrollments(profile.id),
    ]);
    if (skillRes.error) showToast(skillRes.error.message || 'Could not load skills.', 'error');
    else setSkills(skillRes.data);
    if (eventRes.error) showToast(eventRes.error.message || 'Could not load training programs.', 'error');
    else setEvents(eventRes.data);
    if (!enrollRes.error) setMyEnrollments(enrollRes.data);
  }, [profile, tenant]);

  useFocusEffect(useCallback(() => { setLoading(true); fetchData().finally(() => setLoading(false)); }, [fetchData]));

  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const enrollmentFor = (eventId: string) => myEnrollments.find((e) => e.event_id === eventId);

  const handleEnroll = async (eventId: string) => {
    if (!tenant || !profile) return;
    setEnrolling(eventId);
    try {
      const { error } = await enrollInEvent(tenant.id, eventId, profile.id);
      if (error) throw error;
      showToast('Enrolled!', 'success');
      fetchData();
    } catch (err: any) {
      showToast('Failed: ' + (err.message || 'Something went wrong'), 'error');
    } finally {
      setEnrolling(null);
    }
  };

  const openFeedback = (enrollment: any) => {
    setFeedbackTarget(enrollment);
    setRating(enrollment.feedback_rating || 0);
    setNotes(enrollment.feedback_notes || '');
  };

  const handleFeedbackSubmit = async () => {
    if (!feedbackTarget || rating === 0) { showToast('Please pick a star rating.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await submitTrainingFeedback(feedbackTarget.id, rating, notes.trim());
      if (error) throw error;
      showToast('Thanks for the feedback!', 'success');
      setFeedbackTarget(null);
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
          <Text style={s.title}>Training</Text>
          <Text style={s.subtitle}>Skills and learning programs</Text>
        </View>
      </View>

      <View style={s.tabContainer}>
        {(['programs', 'skills'] as const).map((key) => {
          const icons = { programs: 'school-outline' as const, skills: 'ribbon-outline' as const };
          const labels = { programs: 'Programs', skills: 'My Skills' };
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
        ) : activeTab === 'skills' ? (
          skills.length === 0 ? (
            <View style={s.emptyCard}>
              <View style={s.emptyIconWrap}><Ionicons name="ribbon-outline" size={32} color={C.primary} /></View>
              <Text style={s.emptyTitle}>No skills assessed yet</Text>
              <Text style={s.emptyText}>Your manager will assess your skills over time.</Text>
            </View>
          ) : (
            <View style={s.list}>
              {skills.map((sk) => (
                <View key={sk.id} style={s.skillCard}>
                  <View style={s.skillTop}>
                    <Text style={s.skillName}>{sk.skill?.name}</Text>
                    <Text style={s.skillCategory}>{sk.skill?.category}</Text>
                  </View>
                  <View style={s.starsRow}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Ionicons key={n} name={n <= sk.level ? 'star' : 'star-outline'} size={18} color={C.amber} />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )
        ) : events.length === 0 ? (
          <View style={s.emptyCard}>
            <View style={s.emptyIconWrap}><Ionicons name="school-outline" size={32} color={C.primary} /></View>
            <Text style={s.emptyTitle}>No training programs yet</Text>
            <Text style={s.emptyText}>Check back later for upcoming training sessions.</Text>
          </View>
        ) : (
          <View style={s.list}>
            {events.map((ev) => {
              const enrollment = enrollmentFor(ev.id);
              const es = enrollment ? ENROLL_STATUS_STYLE[enrollment.status] || ENROLL_STATUS_STYLE.Enrolled : null;
              const seatsLeft = ev.capacity ? ev.capacity - (ev.enrollments?.length || 0) : null;
              return (
                <View key={ev.id} style={s.eventCard}>
                  <View style={s.eventTop}>
                    <Text style={s.eventTitle}>{ev.program?.title || 'Training'}</Text>
                    {es && (
                      <View style={[s.statusPill, { backgroundColor: es.bg }]}>
                        <Text style={[s.statusText, { color: es.color }]}>{enrollment.status}</Text>
                      </View>
                    )}
                  </View>
                  <View style={s.metaRow}>
                    <Ionicons name="calendar-outline" size={12} color={C.muted} />
                    <Text style={s.metaText}>{fmtDate(ev.event_date)}</Text>
                    {!!ev.location && <Text style={s.metaText}> · {ev.location}</Text>}
                  </View>
                  {!!ev.trainer && <Text style={s.metaText}>Trainer: {ev.trainer}</Text>}
                  {seatsLeft != null && <Text style={s.metaText}>{Math.max(0, seatsLeft)} seats left</Text>}
                  {!!ev.program?.description && <Text style={s.eventDesc} numberOfLines={2}>{ev.program.description}</Text>}

                  {!enrollment ? (
                    <TouchableOpacity style={s.enrollBtn} onPress={() => handleEnroll(ev.id)} disabled={enrolling === ev.id} activeOpacity={0.85}>
                      {enrolling === ev.id ? <ActivityIndicator color="#fff" size="small" /> : (
                        <>
                          <Ionicons name="add-circle-outline" size={15} color="#fff" />
                          <Text style={s.enrollBtnText}>Enroll</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  ) : enrollment.status === 'Attended' && !enrollment.feedback_rating ? (
                    <TouchableOpacity style={s.feedbackBtn} onPress={() => openFeedback(enrollment)}>
                      <Ionicons name="star-outline" size={14} color={C.primary} />
                      <Text style={s.feedbackBtnText}>Leave feedback</Text>
                    </TouchableOpacity>
                  ) : enrollment.feedback_rating ? (
                    <View style={s.starsRow}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Ionicons key={n} name={n <= enrollment.feedback_rating ? 'star' : 'star-outline'} size={14} color={C.amber} />
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal visible={!!feedbackTarget} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Training Feedback</Text>
              <TouchableOpacity onPress={() => setFeedbackTarget(null)} style={s.closeBtn}>
                <Ionicons name="close" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>
            <View style={s.starsPickerRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity key={n} onPress={() => setRating(n)}>
                  <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={34} color={C.amber} />
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.formGroup}>
              <Text style={s.formLabel}>Notes (optional)</Text>
              <TextInput style={[s.input, s.textarea]} value={notes} multiline numberOfLines={3}
                placeholder="What did you think of this training?" placeholderTextColor={C.muted}
                onChangeText={setNotes} />
            </View>
            <View style={s.modalFooter}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setFeedbackTarget(null)}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.submitBtn, saving && { opacity: 0.6 }]} onPress={handleFeedbackSubmit} disabled={saving} activeOpacity={0.85}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.submitText}>Submit</Text>}
              </TouchableOpacity>
            </View>
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
  skillCard: { backgroundColor: C.surface, borderRadius: 16, padding: 14, gap: 8, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  skillTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  skillName: { fontSize: 14.5, fontWeight: '700', color: C.text },
  skillCategory: { fontSize: 11.5, color: C.muted, backgroundColor: C.bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  starsRow: { flexDirection: 'row', gap: 3 },
  eventCard: { backgroundColor: C.surface, borderRadius: 18, padding: 16, gap: 6, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  eventTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  eventTitle: { fontSize: 15.5, fontWeight: '800', color: C.text, flex: 1 },
  statusPill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  statusText: { fontSize: 11.5, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12.5, color: C.muted },
  eventDesc: { fontSize: 12.5, color: C.text, lineHeight: 18, marginTop: 2 },
  enrollBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 11, marginTop: 8 },
  enrollBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  feedbackBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 4 },
  feedbackBtnText: { fontSize: 12.5, color: C.primary, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, maxHeight: '90%' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: C.text },
  closeBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  starsPickerRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 20 },
  formGroup: { marginBottom: 14 },
  formLabel: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 7 },
  input: { borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: C.text, backgroundColor: '#FAFAFA' },
  textarea: { height: 80, textAlignVertical: 'top' },
  modalFooter: { flexDirection: 'row', gap: 12, marginTop: 8, paddingBottom: 12 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: C.muted },
  submitBtn: { flex: 1, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 10, elevation: 5 },
  submitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
