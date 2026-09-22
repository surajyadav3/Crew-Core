import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { fetchMyProcess, updateTaskStatus } from '@/services/onboardingService';
import { showToast } from '@/components/Toast';
import { fmtDate } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  'In Progress': { bg: C.primaryBg, color: C.primary },
  Completed: { bg: C.successBg, color: C.success },
  Cancelled: { bg: C.dangerBg, color: C.danger },
};
const TASK_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Done: { bg: C.successBg, color: C.success },
  'In Progress': { bg: C.primaryBg, color: C.primary },
  'To Do': { bg: C.warningBg, color: C.warning },
};

export default function MyOnboardingScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [process, setProcess] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await fetchMyProcess(profile.id);
    if (error) { showToast(error.message || 'Could not load onboarding.', 'error'); return; }
    setProcess(data);
  }, [profile]);

  useFocusEffect(useCallback(() => { setLoading(true); fetchData().finally(() => setLoading(false)); }, [fetchData]));
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const handleMarkDone = async (taskId: string) => {
    setSavingId(taskId);
    const { error } = await updateTaskStatus(taskId, 'Done');
    if (error) showToast('Failed: ' + error.message, 'error');
    else fetchData();
    setSavingId(null);
  };

  const statusStyle = STATUS_STYLE[process?.status] || STATUS_STYLE['In Progress'];

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>My Onboarding</Text>
          <Text style={s.subtitle}>Your onboarding checklist</Text>
        </View>
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}>
        {loading ? (
          <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>
        ) : !process ? (
          <View style={s.emptyCard}>
            <View style={s.emptyIconWrap}><Ionicons name="clipboard-outline" size={32} color={C.primary} /></View>
            <Text style={s.emptyTitle}>No onboarding checklist yet</Text>
            <Text style={s.emptyText}>Your onboarding checklist will show up here once HR assigns one.</Text>
          </View>
        ) : (
          <View style={s.card}>
            <View style={s.cardHeader}>
              <View style={s.cardHeaderTop}>
                <Text style={s.cardTitle}>Onboarding</Text>
                <View style={[s.statusPill, { backgroundColor: statusStyle.bg }]}>
                  <Text style={[s.statusText, { color: statusStyle.color }]}>{process.status}</Text>
                </View>
              </View>
              <Text style={s.cardMeta}>
                Started {fmtDate(process.start_date)}{process.target_date ? ` · Target ${fmtDate(process.target_date)}` : ''}
              </Text>
            </View>

            {(process.tasks || []).length === 0 ? (
              <Text style={s.noTasks}>No tasks yet.</Text>
            ) : (
              <View style={s.taskList}>
                {process.tasks.map((t: any) => {
                  const ts = TASK_STATUS_STYLE[t.status] || TASK_STATUS_STYLE['To Do'];
                  return (
                    <View key={t.id} style={s.taskRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.taskTitle}>{t.title}</Text>
                        {!!t.description && <Text style={s.taskDesc}>{t.description}</Text>}
                        <View style={s.taskMetaRow}>
                          <Text style={s.taskCategory}>{t.category}</Text>
                          <View style={[s.taskStatusPill, { backgroundColor: ts.bg }]}>
                            <Text style={[s.taskStatusText, { color: ts.color }]}>{t.status}</Text>
                          </View>
                        </View>
                      </View>
                      {t.status !== 'Done' && (
                        <TouchableOpacity style={s.doneBtn} onPress={() => handleMarkDone(t.id)} disabled={savingId === t.id}>
                          {savingId === t.id ? <ActivityIndicator color={C.primary} size="small" /> : <Text style={s.doneBtnText}>Mark Done</Text>}
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </ScrollView>
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
  loadingBox: { padding: 60, alignItems: 'center' },
  emptyCard: { margin: 14, backgroundColor: C.surface, borderRadius: 20, padding: 40, alignItems: 'center', gap: 10, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  emptyIconWrap: { width: 68, height: 68, borderRadius: 22, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  emptyText: { fontSize: 13, color: C.muted, textAlign: 'center' },
  card: { margin: 14, backgroundColor: C.surface, borderRadius: 20, padding: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  cardHeader: { marginBottom: 14 },
  cardHeaderTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: '800', color: C.text },
  cardMeta: { fontSize: 12, color: C.muted, marginTop: 4 },
  statusPill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 11.5, fontWeight: '700' },
  noTasks: { color: C.muted, fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  taskList: { gap: 10 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 },
  taskTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  taskDesc: { fontSize: 12, color: C.muted, marginTop: 2 },
  taskMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  taskCategory: { fontSize: 11, color: C.muted },
  taskStatusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  taskStatusText: { fontSize: 10.5, fontWeight: '700' },
  doneBtn: { borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, minWidth: 84, alignItems: 'center' },
  doneBtnText: { fontSize: 12, fontWeight: '700', color: C.primary },
});
