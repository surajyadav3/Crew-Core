import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Animated, Dimensions, Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { fetchMyMonthAttendance } from '@/services/attendanceService';
import { listMyNotifications, markNotificationRead } from '@/services/notificationService';
import {
  todayStr, dateStr, timeStr, diffHours, fmtDuration, monthLabel, fmtTime12, fmtDate,
} from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

const UPDATE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  policy: 'document-text-outline',
  announcement: 'megaphone-outline',
  leave_approved: 'checkmark-circle-outline',
  leave_rejected: 'close-circle-outline',
  clock_in: 'log-in-outline',
  clock_out: 'log-out-outline',
};

const { width: SCREEN_W } = Dimensions.get('window');

// ── Shimmer skeleton ───────────────────────────────────────────────────────────
function Skeleton({ w, h, radius = 10 }: { w: number | string; h: number; radius?: number }) {
  const anim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 0.9, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={{
      width: w as any, height: h, borderRadius: radius,
      backgroundColor: '#DDD6FE', opacity: anim,
    }} />
  );
}

function HomeSkeleton() {
  return (
    <View style={{ paddingTop: 8 }}>
      <View style={[sk.card, { marginHorizontal: 16, marginBottom: 14, padding: 20, gap: 14 }]}>
        <Skeleton w="50%" h={12} />
        <Skeleton w="70%" h={22} radius={6} />
        <Skeleton w="85%" h={12} />
        <Skeleton w={SCREEN_W - 72} h={48} radius={14} />
      </View>
      <View style={[sk.row, { marginHorizontal: 16, gap: 10 }]}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={[sk.card, { flex: 1, padding: 14, gap: 8, alignItems: 'center', borderRadius: 16 }]}>
            <Skeleton w={30} h={24} radius={6} />
            <Skeleton w={38} h={10} radius={4} />
          </View>
        ))}
      </View>
    </View>
  );
}

const sk = StyleSheet.create({
  card: { backgroundColor: '#EDE9FE', borderRadius: 18 },
  row: { flexDirection: 'row' },
});

// ── Greeting helper ────────────────────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ── Animated card wrapper ──────────────────────────────────────────────────────
function AnimatedCard({ children, delay = 0, style }: any) {
  const translateY = useRef(new Animated.Value(30)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 500, delay, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 400, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}

// ── Pulse dot ──────────────────────────────────────────────────────────────────
function PulseDot({ color }: { color: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.6, duration: 700, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <View style={{ width: 12, height: 12, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{
        position: 'absolute',
        width: 12, height: 12, borderRadius: 6,
        backgroundColor: color, opacity: 0.3,
        transform: [{ scale }],
      }} />
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const { profile, tenant } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [todayRec, setTodayRec] = useState<any>(null);
  const [summary, setSummary] = useState({ present: 0, absent: 0, late: 0, totalHours: 0 });
  const [updates, setUpdates] = useState<any[]>([]);
  const headerFade = useRef(new Animated.Value(0)).current;

  const now = new Date();

  const loadData = useCallback(async () => {
    if (!profile || !tenant) return;
    setLoading(true);
    try {
      const { data } = await fetchMyMonthAttendance(profile.id, now.getFullYear(), now.getMonth());
      const today = data.find((r: any) => r.date === todayStr()) || null;
      setTodayRec(today);

      let present = 0, absent = 0, late = 0, totalHours = 0;
      for (let d = 1; d <= new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(); d++) {
        const date = new Date(now.getFullYear(), now.getMonth(), d);
        if (date > now || date.getDay() === 0 || date.getDay() === 6) continue;
        const rec = data.find((r: any) => r.date === dateStr(date));
        if (!rec) { if (date < now) absent++; continue; }
        if (rec.status === 'Present') present++;
        else if (rec.status === 'Late') { present++; late++; }
        else if (rec.status === 'Absent') absent++;
        totalHours += rec.total_hours || 0;
      }
      setSummary({ present, absent, late, totalHours });
    } finally {
      setLoading(false);
    }
  }, [profile, tenant]);

  const loadUpdates = useCallback(async () => {
    if (!profile) return;
    const { data } = await listMyNotifications(profile.id);
    setUpdates(data.slice(0, 5));
  }, [profile]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadUpdates(); }, [loadUpdates]);

  const handleOpenUpdate = async (n: any) => {
    if (n.read) return;
    await markNotificationRead(n.id);
    setUpdates((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
  };

  useEffect(() => {
    Animated.timing(headerFade, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, []);

  const punches = todayRec?.punches || [];
  const sortedPunches = [...punches].sort((a: any, b: any) => a.punch_time.localeCompare(b.punch_time));
  const ins = sortedPunches.filter((p: any) => p.punch_type === 'in');
  const outs = sortedPunches.filter((p: any) => p.punch_type === 'out');
  const isClockedIn = ins.length > outs.length;
  const hasPunches = punches.length > 0;

  let workedSecs = 0;
  for (let i = 0; i < ins.length; i++) {
    const outT = outs[i]?.punch_time || timeStr(new Date());
    workedSecs += diffHours(ins[i].punch_time, outT) * 3600;
  }
  const workedDisplay = workedSecs > 0 ? fmtDuration(workedSecs / 3600) : null;

  const lastPunch = sortedPunches[sortedPunches.length - 1];
  const statusLabel = isClockedIn ? 'Currently Working' : hasPunches ? 'Clocked Out' : 'Not Clocked In';
  const statusColor = isClockedIn ? C.success : hasPunches ? C.warning : C.muted;
  const statusBg = isClockedIn ? C.successBg : hasPunches ? C.warningBg : '#F1F5F9';

  const dateLabel = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  const QUICK_ACTIONS = [
    { label: 'Clock In / Out', icon: 'finger-print' as const, color: C.primary, bg: C.primaryBg, route: '/attendance' },
    { label: 'Request Leave', icon: 'calendar-outline' as const, color: C.teal, bg: C.tealBg, route: '/leaves' },
    { label: 'Special Request', icon: 'flash-outline' as const, color: C.amber, bg: C.amberBg, route: '/requests' },
    { label: 'Regularize', icon: 'calendar-number-outline' as const, color: C.rose, bg: C.roseBg, route: '/requests' },
    { label: 'My Payslips', icon: 'document-text-outline' as const, color: C.success, bg: C.successBg, route: '/payslips' },
    { label: 'My Profile', icon: 'person-circle-outline' as const, color: C.primaryDark, bg: '#DDD6FE', route: '/profile' },
  ];

  const initials = [profile?.first_name?.[0], profile?.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* ── Hero Header ──────────────────────────────────────────────── */}
        <Animated.View style={[s.hero, { opacity: headerFade }]}>
          <View style={s.heroDecor1} />
          <View style={s.heroDecor2} />
          <View style={s.heroRow}>
            <View style={s.heroLeft}>
              <Text style={s.heroGreeting}>{greeting()} 👋</Text>
              <Text style={s.heroName} numberOfLines={1}>
                {profile?.first_name || 'there'} {profile?.last_name || ''}
              </Text>
              {tenant && (
                <View style={s.heroBadge}>
                  <Ionicons name="business-outline" size={11} color="rgba(255,255,255,0.7)" />
                  <Text style={s.heroBadgeText}>{tenant.company_name}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity onPress={() => router.push('/profile' as any)} activeOpacity={0.8}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{initials}</Text>
              </View>
              <View style={s.avatarOnline} />
            </TouchableOpacity>
          </View>

          {/* Date chip */}
          <View style={s.dateChip}>
            <Ionicons name="calendar-clear-outline" size={12} color="rgba(255,255,255,0.6)" />
            <Text style={s.dateChipText}>{dateLabel}</Text>
            <Text style={s.dateChipMuted}>· {monthLabel(now.getMonth(), now.getFullYear())}</Text>
          </View>
        </Animated.View>

        {/* ── Content ──────────────────────────────────────────────────── */}
        {loading ? (
          <HomeSkeleton />
        ) : (
          <>
            {/* ── Today's Status Card ─────────────────────────────────── */}
            <AnimatedCard delay={100} style={s.todayCard}>
              <View style={s.todayCardInner}>
                {/* Left colored accent */}
                <View style={[s.cardAccent, { backgroundColor: statusColor }]} />
                <View style={{ flex: 1 }}>
                  <View style={s.todayTop}>
                    <View style={[s.statusPill, { backgroundColor: statusBg }]}>
                      <PulseDot color={statusColor} />
                      <Text style={[s.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
                    </View>
                    {workedDisplay && (
                      <View style={s.workedPill}>
                        <Ionicons name="time-outline" size={12} color={C.primary} />
                        <Text style={s.workedText}>{workedDisplay}</Text>
                      </View>
                    )}
                  </View>

                  {lastPunch && (
                    <View style={s.lastPunchRow}>
                      <Ionicons name={lastPunch.punch_type === 'in' ? 'log-in-outline' : 'log-out-outline'} size={13} color={C.muted} />
                      <Text style={s.lastPunchText}>
                        Last punch: {fmtTime12(lastPunch.punch_time)} · {lastPunch.punch_type === 'in' ? 'Clock In' : 'Clock Out'}
                      </Text>
                    </View>
                  )}
                  {!hasPunches && (
                    <View style={s.lastPunchRow}>
                      <Ionicons name="time-outline" size={13} color={C.muted} />
                      <Text style={s.lastPunchText}>You haven't clocked in today yet.</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={s.attendanceBtn}
                    onPress={() => router.push('/attendance' as any)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="finger-print" size={18} color="#fff" />
                    <Text style={s.attendanceBtnText}>
                      {isClockedIn ? 'Clock Out / View Attendance' : 'Go to Attendance'}
                    </Text>
                    <View style={s.btnArrow}>
                      <Ionicons name="arrow-forward" size={14} color={C.primary} />
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            </AnimatedCard>

            {/* ── Month Summary ────────────────────────────────────────── */}
            <AnimatedCard delay={200}>
              <Text style={s.sectionLabel}>This Month</Text>
              <View style={s.summaryRow}>
                {[
                  { val: summary.present, label: 'Present', color: C.success, bg: C.successBg, icon: 'checkmark-circle' as const },
                  { val: summary.absent, label: 'Absent', color: C.danger, bg: C.dangerBg, icon: 'close-circle' as const },
                  { val: summary.late, label: 'Late', color: C.warning, bg: C.warningBg, icon: 'alert-circle' as const },
                  { val: fmtDuration(summary.totalHours), label: 'Hours', color: C.primary, bg: C.primaryBg, icon: 'timer-outline' as const },
                ].map((item) => (
                  <TouchableOpacity
                    key={item.label}
                    style={[s.summaryCard, { backgroundColor: item.bg }]}
                    onPress={() => router.push('/attendance' as any)}
                    activeOpacity={0.75}
                  >
                    <Ionicons name={item.icon} size={18} color={item.color} />
                    <Text style={[s.summaryVal, { color: item.color }]}>{item.val}</Text>
                    <Text style={[s.summaryLbl, { color: item.color + 'AA' }]}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </AnimatedCard>
          </>
        )}

        {/* ── Announcements & Updates ──────────────────────────────────── */}
        <AnimatedCard delay={250}>
          <View style={s.sectionHeaderRow}>
            <Text style={[s.sectionLabel, { marginTop: 0, paddingHorizontal: 0 }]}>Announcements & Updates</Text>
            {updates.length > 0 && (
              <TouchableOpacity onPress={() => router.push('/notices' as any)} activeOpacity={0.7}>
                <Text style={s.seeAllText}>See all</Text>
              </TouchableOpacity>
            )}
          </View>
          {updates.length === 0 ? (
            <View style={s.updatesEmpty}>
              <Ionicons name="notifications-outline" size={22} color={C.muted} />
              <Text style={s.updatesEmptyText}>You're all caught up. New policies, announcements and approvals will show up here.</Text>
            </View>
          ) : (
            <View style={s.updatesList}>
              {updates.map((n) => (
                <TouchableOpacity
                  key={n.id}
                  style={[s.updateCard, !n.read && s.updateCardUnread]}
                  onPress={() => handleOpenUpdate(n)}
                  activeOpacity={0.85}
                >
                  <View style={[s.updateIconWrap, !n.read && { backgroundColor: C.primaryBg }]}>
                    <Ionicons name={UPDATE_ICON[n.type] || 'notifications-outline'} size={17} color={C.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.updateTitle} numberOfLines={1}>{n.title}</Text>
                    {!!n.body && <Text style={s.updateBody} numberOfLines={2}>{n.body}</Text>}
                    <Text style={s.updateTime}>{fmtDate(n.created_at)}</Text>
                  </View>
                  {!n.read && <View style={s.updateDot} />}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </AnimatedCard>

        {/* ── Quick Actions ─────────────────────────────────────────────── */}
        <AnimatedCard delay={300}>
          <Text style={s.sectionLabel}>Quick Actions</Text>
          <View style={s.actionsGrid}>
            {QUICK_ACTIONS.map((item, idx) => (
              <TouchableOpacity
                key={item.label}
                style={s.actionCard}
                onPress={() => router.push(item.route as any)}
                activeOpacity={0.75}
              >
                <View style={[s.actionIconRing, { backgroundColor: item.bg }]}>
                  <Ionicons name={item.icon} size={26} color={item.color} />
                </View>
                <Text style={s.actionLabel} numberOfLines={2}>{item.label}</Text>
                <View style={s.actionArrow}>
                  <Ionicons name="chevron-forward" size={12} color={C.muted} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </AnimatedCard>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.dark },
  scroll: { flex: 1, backgroundColor: C.bg },

  // Hero
  hero: {
    backgroundColor: C.dark,
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24,
    overflow: 'hidden',
  },
  heroDecor1: {
    position: 'absolute', top: -40, right: -40,
    width: 160, height: 160, borderRadius: 80,
    backgroundColor: C.primary, opacity: 0.12,
  },
  heroDecor2: {
    position: 'absolute', bottom: -20, left: -20,
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: C.primaryLight, opacity: 0.08,
  },
  heroRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroLeft: { flex: 1, paddingRight: 12 },
  heroGreeting: { fontSize: 13, color: 'rgba(255,255,255,0.5)', fontWeight: '500', marginBottom: 4 },
  heroName: { fontSize: 26, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  heroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7,
    backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
    alignSelf: 'flex-start',
  },
  heroBadgeText: { fontSize: 11.5, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  avatar: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.15)',
    shadowColor: C.primary, shadowOpacity: 0.5, shadowRadius: 10, elevation: 6,
  },
  avatarText: { fontSize: 18, fontWeight: '800', color: '#fff' },
  avatarOnline: {
    position: 'absolute', bottom: 0, right: 0,
    width: 13, height: 13, borderRadius: 6.5,
    backgroundColor: C.success, borderWidth: 2, borderColor: C.dark,
  },
  dateChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    alignSelf: 'flex-start',
  },
  dateChipText: { fontSize: 12, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
  dateChipMuted: { fontSize: 12, color: 'rgba(255,255,255,0.4)' },

  // Today card
  todayCard: { marginHorizontal: 16, marginTop: 14, marginBottom: 6 },
  todayCardInner: {
    backgroundColor: C.surface, borderRadius: 20,
    flexDirection: 'row', overflow: 'hidden',
    shadowColor: C.primary, shadowOpacity: 0.1, shadowRadius: 16, elevation: 5,
  },
  cardAccent: { width: 4 },
  todayTop: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', padding: 16, paddingBottom: 8,
  },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
  },
  statusLabel: { fontSize: 12.5, fontWeight: '700' },
  workedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.primaryBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
  },
  workedText: { fontSize: 12, fontWeight: '700', color: C.primary },
  lastPunchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingBottom: 10,
  },
  lastPunchText: { fontSize: 12.5, color: C.muted },
  attendanceBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.dark, borderRadius: 14,
    paddingVertical: 13, paddingHorizontal: 16, margin: 12, marginTop: 4,
  },
  attendanceBtnText: { flex: 1, fontSize: 14, fontWeight: '700', color: '#fff' },
  btnArrow: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Section label
  sectionLabel: {
    fontSize: 11.5, fontWeight: '700', color: C.muted,
    textTransform: 'uppercase', letterSpacing: 1,
    paddingHorizontal: 20, marginTop: 22, marginBottom: 10,
  },

  // Summary
  summaryRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  summaryCard: {
    flex: 1, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 6,
    alignItems: 'center', gap: 4,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  summaryVal: { fontSize: 18, fontWeight: '900' },
  summaryLbl: { fontSize: 9.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },

  // Announcements & Updates
  sectionHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, marginTop: 22, marginBottom: 10,
  },
  seeAllText: { fontSize: 12.5, fontWeight: '700', color: C.primary },
  updatesEmpty: {
    marginHorizontal: 16, backgroundColor: C.surface, borderRadius: 18,
    padding: 20, flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  updatesEmptyText: { flex: 1, fontSize: 12.5, color: C.muted, lineHeight: 18 },
  updatesList: { paddingHorizontal: 16, gap: 10 },
  updateCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: C.surface, borderRadius: 16, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  updateCardUnread: { borderWidth: 1, borderColor: C.primaryBg },
  updateIconWrap: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: C.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  updateTitle: { fontSize: 13.5, fontWeight: '700', color: C.text },
  updateBody: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 17 },
  updateTime: { fontSize: 10.5, color: '#CBD5E1', marginTop: 4 },
  updateDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary, marginTop: 4 },

  // Quick actions
  actionsGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 16, gap: 10,
  },
  actionCard: {
    width: '30.5%',
    backgroundColor: C.surface, borderRadius: 18,
    paddingVertical: 18, paddingHorizontal: 10,
    alignItems: 'center', gap: 8,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
    position: 'relative',
  },
  actionIconRing: {
    width: 56, height: 56, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 11.5, fontWeight: '600', color: C.text,
    textAlign: 'center', lineHeight: 16,
  },
  actionArrow: {
    position: 'absolute', top: 10, right: 10,
  },
});
