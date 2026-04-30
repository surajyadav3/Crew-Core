import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { fetchMyMonthStats } from '@/services/attendanceService';
import { fetchMyAdvanceBalance } from '@/services/advanceService';
import { fmt, monthLabel } from '@/lib/helpers';

const C = {
  primary: '#00AEEF',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  text: '#1E293B',
  muted: '#94A3B8',
  border: '#E2E8F0',
  success: '#22C55E',
  warning: '#F59E0B',
  purple: '#8B5CF6',
};

function StatCard({
  icon, iconBg, value, label,
}: { icon: keyof typeof Ionicons.glyphMap; iconBg: string; value: string; label: string }) {
  return (
    <View style={s.statCard}>
      <View style={[s.statIcon, { backgroundColor: iconBg + '20' }]}>
        <Ionicons name={icon} size={22} color={iconBg} />
      </View>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

export default function DashboardScreen() {
  const { profile, tenant, signOut } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState({ presentDays: 0, outstandingAdvances: 0 });
  const [showSalary, setShowSalary] = useState(false);
  const [loading, setLoading] = useState(true);

  const now = new Date();

  useEffect(() => {
    if (!profile || !tenant) return;
    setLoading(true);
    Promise.all([
      fetchMyMonthStats(profile.id, now.getFullYear(), now.getMonth()),
      fetchMyAdvanceBalance(profile.id),
    ]).then(([attRes, advRes]) => {
      setStats({ presentDays: attRes.presentDays, outstandingAdvances: advRes.total });
      setLoading(false);
    });
  }, [profile, tenant]);

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const ctcDisplay = showSalary ? fmt(profile?.ctc || 0) : '₹ ••••••';
  const advDisplay = showSalary ? fmt(stats.outstandingAdvances) : '₹ ••••••';

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.greeting}>Welcome back,</Text>
            <Text style={s.name}>{profile?.first_name || 'User'} 👋</Text>
            <Text style={s.period}>{monthLabel(now.getMonth(), now.getFullYear())}</Text>
          </View>
          <TouchableOpacity style={s.signOutBtn} onPress={handleSignOut}>
            <Ionicons name="log-out-outline" size={22} color={C.muted} />
          </TouchableOpacity>
        </View>

        {/* Company badge */}
        {tenant && (
          <View style={s.companyBadge}>
            <Ionicons name="business" size={14} color={C.primary} />
            <Text style={s.companyName}>{tenant.company_name}</Text>
          </View>
        )}

        {/* Stats */}
        {loading ? (
          <View style={s.loadingBox}>
            <ActivityIndicator color={C.primary} />
          </View>
        ) : (
          <>
            <View style={s.salaryRevealRow}>
              <Text style={s.sectionTitle}>Your Stats</Text>
              <TouchableOpacity style={s.revealBtn} onPress={() => setShowSalary((v) => !v)}>
                <Ionicons name={showSalary ? 'eye-off-outline' : 'eye-outline'} size={16} color={C.primary} />
                <Text style={s.revealText}>{showSalary ? 'Hide' : 'Reveal'}</Text>
              </TouchableOpacity>
            </View>

            <View style={s.statsRow}>
              <StatCard
                icon="wallet-outline"
                iconBg={C.success}
                value={ctcDisplay}
                label="Monthly CTC"
              />
              <StatCard
                icon="calendar-clear-outline"
                iconBg={C.primary}
                value={String(stats.presentDays)}
                label="Days Present"
              />
              <StatCard
                icon="cash-outline"
                iconBg={C.warning}
                value={advDisplay}
                label="Loan Balance"
              />
            </View>
          </>
        )}

        {/* Quick Actions */}
        <Text style={[s.sectionTitle, { marginTop: 24 }]}>Quick Actions</Text>
        <View style={s.actionsGrid}>
          {[
            { label: 'Clock In / Out', icon: 'finger-print' as const, color: C.primary, route: '/attendance' },
            { label: 'My Payslip', icon: 'document-text' as const, color: C.success, route: '/payslips' },
            { label: 'Request Leave', icon: 'calendar' as const, color: C.purple, route: '/leaves' },
            { label: 'Attendance Log', icon: 'list' as const, color: C.warning, route: '/attendance' },
          ].map((item) => (
            <TouchableOpacity
              key={item.label}
              style={s.actionCard}
              onPress={() => router.push(item.route as any)}
            >
              <View style={[s.actionIcon, { backgroundColor: item.color + '15' }]}>
                <Ionicons name={item.icon} size={26} color={item.color} />
              </View>
              <Text style={s.actionLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Announcements placeholder */}
        <Text style={[s.sectionTitle, { marginTop: 24 }]}>Announcements</Text>
        <View style={s.emptyCard}>
          <Ionicons name="megaphone-outline" size={32} color={C.muted} />
          <Text style={s.emptyTitle}>No new announcements</Text>
          <Text style={s.emptyText}>Team updates will appear here.</Text>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F0F9FF' },
  scroll: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16,
    backgroundColor: '#F0F9FF',
  },
  greeting: { fontSize: 14, color: C.muted },
  name: { fontSize: 22, fontWeight: '800', color: C.text },
  period: { fontSize: 12, color: C.muted, marginTop: 2 },
  signOutBtn: { padding: 8 },
  companyBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: 20, marginBottom: 16,
    backgroundColor: '#E0F7FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  companyName: { fontSize: 13, color: C.primary, fontWeight: '600' },
  loadingBox: { height: 120, alignItems: 'center', justifyContent: 'center' },
  salaryRevealRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.text, paddingHorizontal: 20, marginBottom: 12 },
  revealBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  revealText: { fontSize: 13, color: C.primary, fontWeight: '600' },
  statsRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 20 },
  statCard: {
    flex: 1, backgroundColor: C.surface, borderRadius: 16,
    padding: 14, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  statIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  statValue: { fontSize: 14, fontWeight: '800', color: C.text, textAlign: 'center' },
  statLabel: { fontSize: 10, color: C.muted, marginTop: 3, textAlign: 'center' },
  actionsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12,
    paddingHorizontal: 20,
  },
  actionCard: {
    width: '47%', backgroundColor: C.surface, borderRadius: 16,
    padding: 16, alignItems: 'center', gap: 10,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  actionIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 13, fontWeight: '600', color: C.text, textAlign: 'center' },
  emptyCard: {
    marginHorizontal: 20, backgroundColor: C.surface, borderRadius: 16,
    padding: 32, alignItems: 'center', gap: 8,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: C.text },
  emptyText: { fontSize: 13, color: C.muted, textAlign: 'center' },
});
