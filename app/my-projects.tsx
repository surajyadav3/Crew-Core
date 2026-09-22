import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { listMyTasks, updateTaskStatus } from '@/services/projectService';
import { showToast } from '@/components/Toast';
import { fmtDate } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

const STATUSES = ['To Do', 'In Progress', 'Done'];
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Done: { bg: C.successBg, color: C.success },
  'In Progress': { bg: C.primaryBg, color: C.primary },
  'To Do': { bg: C.warningBg, color: C.warning },
};

export default function MyProjectsScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerFor, setPickerFor] = useState<any>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await listMyTasks(profile.id);
    if (error) { showToast(error.message || 'Could not load projects.', 'error'); return; }
    setTasks(data);
  }, [profile]);

  useFocusEffect(useCallback(() => { setLoading(true); fetchData().finally(() => setLoading(false)); }, [fetchData]));
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const handleStatus = async (id: string, status: string) => {
    setPickerFor(null);
    setSavingId(id);
    const { error } = await updateTaskStatus(id, status);
    if (error) showToast('Failed: ' + error.message, 'error');
    else fetchData();
    setSavingId(null);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>My Projects</Text>
          <Text style={s.subtitle}>Tasks assigned to you across all projects</Text>
        </View>
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}>
        {loading ? (
          <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>
        ) : tasks.length === 0 ? (
          <View style={s.emptyCard}>
            <View style={s.emptyIconWrap}><Ionicons name="layers-outline" size={32} color={C.primary} /></View>
            <Text style={s.emptyTitle}>No tasks assigned</Text>
            <Text style={s.emptyText}>Project tasks assigned to you will show up here.</Text>
          </View>
        ) : (
          <View style={s.list}>
            {tasks.map((t) => {
              const ts = STATUS_STYLE[t.status] || STATUS_STYLE['To Do'];
              return (
                <View key={t.id} style={s.card}>
                  <Text style={s.taskTitle}>{t.title}</Text>
                  {!!t.description && <Text style={s.taskDesc}>{t.description}</Text>}
                  <View style={s.metaRow}>
                    <Text style={s.projectName}>{t.project?.name || 'No project'}</Text>
                    <Text style={s.dueDate}>{t.due_date ? `Due ${fmtDate(t.due_date)}` : 'No due date'}</Text>
                  </View>
                  <TouchableOpacity
                    style={[s.statusBtn, { backgroundColor: ts.bg }]}
                    onPress={() => setPickerFor(t)}
                    disabled={savingId === t.id}
                  >
                    {savingId === t.id
                      ? <ActivityIndicator color={ts.color} size="small" />
                      : <>
                          <Text style={[s.statusBtnText, { color: ts.color }]}>{t.status}</Text>
                          <Ionicons name="chevron-down" size={14} color={ts.color} />
                        </>}
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal visible={!!pickerFor} animationType="fade" transparent>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setPickerFor(null)}>
          <TouchableOpacity activeOpacity={1} style={s.pickerCard} onPress={() => {}}>
            <Text style={s.pickerTitle}>Update Status</Text>
            {STATUSES.map((st) => (
              <TouchableOpacity key={st} style={s.pickerItem} onPress={() => handleStatus(pickerFor.id, st)}>
                <Text style={s.pickerText}>{st}</Text>
                {pickerFor?.status === st && <Ionicons name="checkmark-circle" size={18} color={C.primary} />}
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
  loadingBox: { padding: 60, alignItems: 'center' },
  emptyCard: { margin: 14, backgroundColor: C.surface, borderRadius: 20, padding: 40, alignItems: 'center', gap: 10, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  emptyIconWrap: { width: 68, height: 68, borderRadius: 22, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  emptyText: { fontSize: 13, color: C.muted, textAlign: 'center' },
  list: { padding: 14, gap: 12 },
  card: { backgroundColor: C.surface, borderRadius: 18, padding: 14, gap: 6, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  taskTitle: { fontSize: 14.5, fontWeight: '700', color: C.text },
  taskDesc: { fontSize: 12, color: C.muted },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  projectName: { fontSize: 12, color: C.muted, fontWeight: '600' },
  dueDate: { fontSize: 12, color: C.muted },
  statusBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingVertical: 8, marginTop: 6, alignSelf: 'flex-start', paddingHorizontal: 14 },
  statusBtnText: { fontSize: 12.5, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  pickerCard: { backgroundColor: C.surface, borderRadius: 24, padding: 20, width: '85%', maxWidth: 340, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 24, elevation: 12 },
  pickerTitle: { fontSize: 16, fontWeight: '800', color: C.text, marginBottom: 14 },
  pickerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderRadius: 12 },
  pickerText: { fontSize: 14, color: C.text },
});
