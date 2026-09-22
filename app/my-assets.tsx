import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { listMyAssignments } from '@/services/assetService';
import { showToast } from '@/components/Toast';
import { fmtDate } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

export default function MyAssetsScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await listMyAssignments(profile.id);
    if (error) { showToast(error.message || 'Could not load assets.', 'error'); return; }
    setAssignments(data);
  }, [profile]);

  useFocusEffect(useCallback(() => { setLoading(true); fetchData().finally(() => setLoading(false)); }, [fetchData]));
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const current = assignments.filter((a) => !a.returned_at);
  const past = assignments.filter((a) => a.returned_at);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>My Assets</Text>
          <Text style={s.subtitle}>Company equipment assigned to you</Text>
        </View>
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}>
        {loading ? (
          <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>
        ) : (
          <>
            <View style={s.card}>
              <Text style={s.cardTitle}>Currently With You</Text>
              {current.length === 0 ? (
                <Text style={s.emptyText}>No assets currently assigned to you.</Text>
              ) : (
                <View style={s.list}>
                  {current.map((a) => (
                    <View key={a.id} style={s.row}>
                      <View style={s.rowIconWrap}>
                        <Ionicons name="laptop-outline" size={18} color={C.teal} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.rowTitle}>{a.asset?.name}</Text>
                        <Text style={s.rowMeta}>{a.asset?.category} · Since {fmtDate(a.assigned_at)}</Text>
                        {!!a.asset?.serial_number && <Text style={s.rowMeta}>Serial: {a.asset.serial_number}</Text>}
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>Past Assignments</Text>
              {past.length === 0 ? (
                <Text style={s.emptyText}>No returned assets yet.</Text>
              ) : (
                <View style={s.list}>
                  {past.map((a) => (
                    <View key={a.id} style={s.row}>
                      <View style={[s.rowIconWrap, { backgroundColor: C.bg }]}>
                        <Ionicons name="laptop-outline" size={18} color={C.muted} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.rowTitle}>{a.asset?.name}</Text>
                        <Text style={s.rowMeta}>{fmtDate(a.assigned_at)} – {fmtDate(a.returned_at)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </>
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
  card: { margin: 14, marginBottom: 4, backgroundColor: C.surface, borderRadius: 20, padding: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 10 },
  emptyText: { fontSize: 13, color: C.muted },
  list: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowIconWrap: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.tealBg, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 13.5, fontWeight: '700', color: C.text },
  rowMeta: { fontSize: 11.5, color: C.muted, marginTop: 1 },
});
