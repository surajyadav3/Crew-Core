import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { useFeatures } from '@/context/FeatureContext';
import { fetchMyAdvanceBalance } from '@/services/advanceService';
import { listMySettlements } from '@/services/compOffService';
import { fmt, fmtDate, monthLabel } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';
import { MORE_TOOLS } from '@/constants/MoreTools';

export default function MoreScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { isEnabled } = useFeatures();
  const visibleTools = MORE_TOOLS.filter((t) => isEnabled(t.featureKey));
  const showAdvanceCard = isEnabled('advances_loans');
  const [advanceBalance, setAdvanceBalance] = useState(0);
  const [settlements, setSettlements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    const [advRes, settleRes] = await Promise.all([
      fetchMyAdvanceBalance(profile.id),
      listMySettlements(profile.id),
    ]);
    setAdvanceBalance(advRes.total || 0);
    if (!settleRes.error) setSettlements(settleRes.data.slice(0, 6));
  }, [profile]);

  useFocusEffect(useCallback(() => { setLoading(true); fetchData().finally(() => setLoading(false)); }, [fetchData]));

  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>More Tools</Text>
          <Text style={s.subtitle}>Everything else, in one place</Text>
        </View>
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}>
        {loading ? (
          <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>
        ) : (
          <View style={s.statsRow}>
            {showAdvanceCard && (
              <View style={s.statCard}>
                <View style={[s.statIconWrap, { backgroundColor: C.dangerBg }]}>
                  <Ionicons name="wallet-outline" size={18} color={C.danger} />
                </View>
                <Text style={s.statLabel}>Advance Balance</Text>
                <Text style={s.statVal}>{fmt(advanceBalance)}</Text>
              </View>
            )}
            <TouchableOpacity style={s.statCard} onPress={() => setShowHistory((v) => !v)} activeOpacity={0.85}>
              <View style={[s.statIconWrap, { backgroundColor: C.tealBg }]}>
                <Ionicons name="swap-horizontal-outline" size={18} color={C.teal} />
              </View>
              <Text style={s.statLabel}>Comp-Off Balance</Text>
              <Text style={s.statVal}>{profile?.comp_off_balance || 0}</Text>
            </TouchableOpacity>
          </View>
        )}

        {showHistory && (
          <View style={s.historyCard}>
            <Text style={s.historyTitle}>Comp-Off Settlement History</Text>
            {settlements.length === 0 ? (
              <Text style={s.historyEmpty}>No settlements recorded yet.</Text>
            ) : settlements.map((st) => (
              <View key={st.id} style={s.historyRow}>
                <Text style={s.historyMonth}>{monthLabel(st.month - 1, st.year)}</Text>
                <Text style={s.historyType}>{st.settlement_type}</Text>
                <Text style={[s.historyCredit, { color: st.comp_offs_credited > 0 ? C.success : C.muted }]}>
                  {st.comp_offs_credited > 0 ? `+${st.comp_offs_credited}` : '—'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {visibleTools.length === 0 ? (
          <View style={s.emptyCard}>
            <Ionicons name="apps-outline" size={28} color={C.muted} />
            <Text style={s.emptyText}>No extra tools are enabled for your company right now.</Text>
          </View>
        ) : (
          <View style={s.grid}>
            {visibleTools.map((t) => (
              <TouchableOpacity key={t.route} style={s.toolCard} onPress={() => router.push(t.route as any)} activeOpacity={0.85}>
                <View style={[s.toolIconWrap, { backgroundColor: t.bg }]}>
                  <Ionicons name={t.icon} size={22} color={t.color} />
                </View>
                <Text style={s.toolLabel}>{t.label}</Text>
                <Text style={s.toolDesc} numberOfLines={2}>{t.desc}</Text>
                <View style={s.toolArrow}>
                  <Ionicons name="chevron-forward" size={14} color={C.muted} />
                </View>
              </TouchableOpacity>
            ))}
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
  loadingBox: { padding: 40, alignItems: 'center' },
  emptyCard: { margin: 14, backgroundColor: C.surface, borderRadius: 18, padding: 30, alignItems: 'center', gap: 10 },
  emptyText: { fontSize: 13, color: C.muted, textAlign: 'center' },
  statsRow: { flexDirection: 'row', gap: 12, padding: 14, paddingBottom: 0 },
  statCard: { flex: 1, backgroundColor: C.surface, borderRadius: 18, padding: 14, gap: 4, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  statIconWrap: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statLabel: { fontSize: 11.5, color: C.muted, fontWeight: '600' },
  statVal: { fontSize: 17, fontWeight: '800', color: C.text },
  historyCard: { margin: 14, marginTop: 12, backgroundColor: C.surface, borderRadius: 16, padding: 14, gap: 8, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  historyTitle: { fontSize: 13, fontWeight: '700', color: C.text, marginBottom: 2 },
  historyEmpty: { fontSize: 12.5, color: C.muted },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  historyMonth: { fontSize: 12.5, color: C.text, fontWeight: '600', flex: 1 },
  historyType: { fontSize: 11.5, color: C.muted, textTransform: 'capitalize', flex: 1, textAlign: 'center' },
  historyCredit: { fontSize: 12.5, fontWeight: '700', flex: 1, textAlign: 'right' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 14, gap: 12 },
  toolCard: { width: '47%', backgroundColor: C.surface, borderRadius: 18, padding: 16, gap: 4, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  toolIconWrap: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  toolLabel: { fontSize: 14, fontWeight: '700', color: C.text },
  toolDesc: { fontSize: 11.5, color: C.muted, lineHeight: 15 },
  toolArrow: { position: 'absolute', top: 14, right: 12 },
});
