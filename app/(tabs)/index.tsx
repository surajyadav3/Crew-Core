import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Animated, Dimensions, Easing, RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { useFeatures } from '@/context/FeatureContext';
import { useClockInOut } from '@/hooks/useClockInOut';
import { fetchMyMonthAttendance } from '@/services/attendanceService';
import { listHolidays } from '@/services/holidayService';
import { listMyNotifications, markNotificationRead } from '@/services/notificationService';
import { fetchMyAdvanceBalance } from '@/services/advanceService';
import { showToast } from '@/components/Toast';
import HolidayBanner from '@/components/HolidayBanner';
import AnnouncementBanner from '@/components/AnnouncementBanner';
import { MORE_TOOLS } from '@/constants/MoreTools';
import {
  dateStr, fmtHMS, monthLabel, fmtTime12, fmtDate, fmt,
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
  const { isEnabled } = useFeatures();
  const router = useRouter();
  const clock = useClockInOut();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState({ present: 0, absent: 0, late: 0, totalHours: 0 });
  const [updates, setUpdates] = useState<any[]>([]);
  const [advanceBalance, setAdvanceBalance] = useState(0);
  const headerFade = useRef(new Animated.Value(0)).current;

  const now = new Date();

  const loadData = useCallback(async () => {
    if (!profile || !tenant) return;
    try {
      const [{ data, error }, { data: holidays, error: holErr }, advRes] = await Promise.all([
        fetchMyMonthAttendance(profile.id, now.getFullYear(), now.getMonth()),
        listHolidays(tenant.id),
        fetchMyAdvanceBalance(profile.id),
      ]);
      if (error) { showToast('Could not load attendance summary.', 'error'); return; }
      if (holErr) showToast('Could not load holidays.', 'error');
      setAdvanceBalance(advRes.total || 0);

      let present = 0, absent = 0, late = 0, totalHours = 0;
      for (let d = 1; d <= new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(); d++) {
        const date = new Date(now.getFullYear(), now.getMonth(), d);
        if (date > now || date.getDay() === 0 || date.getDay() === 6) continue;
        const ds = dateStr(date);
        if ((holidays || []).find((h: any) => h.date === ds && h.status === 'Approved')) continue;
        const rec = data.find((r: any) => r.date === ds);
        if (!rec) { if (date < now) absent++; continue; }
        if (rec.status === 'Present') present++;
        else if (rec.status === 'Late') { present++; late++; }
        else if (rec.status === 'Absent') absent++;
        // Today's total_hours only gets (re)written on clock-out, so while
        // still clocked in it excludes whatever's been worked so far — skip
        // it here and let the render below add today's live-ticking total
        // instead, so the month total doesn't look frozen mid-shift.
        if (d !== now.getDate()) totalHours += rec.total_hours || 0;
      }
      setSummary({ present, absent, late, totalHours });
    } catch (err) {
      console.error('[CrewCore] Dashboard loadData error:', err);
      showToast('Could not load attendance summary.', 'error');
    }
  }, [profile, tenant]);

  const loadUpdates = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await listMyNotifications(profile.id);
    if (error) { showToast('Could not load announcements.', 'error'); return; }
    setUpdates(data.slice(0, 5));
  }, [profile]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadData(), loadUpdates(), clock.refresh()]);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadData, loadUpdates]);

  useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadData(), loadUpdates(), clock.refresh()]);
    setRefreshing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadData, loadUpdates]);

  const handleOpenUpdate = async (n: any) => {
    if (n.is_read) return;
    const { error } = await markNotificationRead(n.id);
    if (error) return;
    setUpdates((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
  };

  useEffect(() => {
    Animated.timing(headerFade, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, []);

  const punches = clock.myPunches?.punches || [];
  const sortedPunches = [...punches].sort((a: any, b: any) => a.punch_time.localeCompare(b.punch_time));
  const isClockedIn = clock.isClockedIn;
  const hasPunches = punches.length > 0;

  const lastPunch = sortedPunches[sortedPunches.length - 1];
  const statusLabel = isClockedIn ? 'Currently Working' : hasPunches ? 'Clocked Out' : 'Not Clocked In';
  const statusColor = isClockedIn ? C.success : hasPunches ? C.warning : C.muted;
  const statusBg = isClockedIn ? C.successBg : hasPunches ? C.warningBg : '#F1F5F9';

  const dateLabel = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  const performanceEnabled = isEnabled('performance_kras') || isEnabled('performance_feedback')
    || isEnabled('performance_pip') || isEnabled('performance_reviews');

  const QUICK_ACTIONS = [
    { label: 'Clock In / Out', icon: 'finger-print' as const, color: C.primary, bg: C.primaryBg, route: '/attendance', featureKey: 'attendance' },
    { label: 'Request Leave', icon: 'calendar-outline' as const, color: C.teal, bg: C.tealBg, route: '/leaves', featureKey: 'leave_requests' },
    { label: 'Special Request', icon: 'flash-outline' as const, color: C.amber, bg: C.amberBg, route: '/requests', featureKey: 'special_requests' },
    { label: 'Regularize', icon: 'calendar-number-outline' as const, color: C.rose, bg: C.roseBg, route: '/requests', featureKey: 'regularize_attendance' },
    ...(performanceEnabled ? [{ label: 'Performance', icon: 'ribbon-outline' as const, color: C.primaryDark, bg: '#DDD6FE', route: '/performance', featureKey: null }] : []),
    { label: 'My Payslips', icon: 'document-text-outline' as const, color: C.success, bg: C.successBg, route: '/payslips', featureKey: 'payslips' },
    { label: 'My Profile', icon: 'person-circle-outline' as const, color: C.primaryDark, bg: '#DDD6FE', route: '/profile', featureKey: null },
    { label: 'More Tools', icon: 'apps-outline' as const, color: C.purple, bg: '#EDE9FE', route: '/more', featureKey: null },
  ].filter((a) => isEnabled(a.featureKey));

  const visibleTools = MORE_TOOLS.filter((t) => isEnabled(t.featureKey));
  const showAdvanceCard = isEnabled('advances_loans');

  const initials = [profile?.first_name?.[0], profile?.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
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
                    {isClockedIn && (
                      <View style={s.workedPill}>
                        <Ionicons name="time-outline" size={12} color={C.primary} />
                        <Text style={s.workedText}>{clock.timerDisplay}</Text>
                      </View>
                    )}
                  </View>

                  {isClockedIn && (
                    <View style={s.liveClockRow}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.success }} />
                      <Text style={s.liveClockText}>{clock.liveClock}</Text>
                    </View>
                  )}

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
                  <View style={s.locationRow}>
                    <Ionicons name="location-outline" size={11} color={C.muted} />
                    <Text style={s.locationRowText} numberOfLines={1}>{clock.locationStatus}</Text>
                  </View>

                  <View style={s.clockActionRow}>
                    <TouchableOpacity
                      style={[s.clockActionBtn, s.clockInBtn, (isClockedIn || clock.actionLoading) && s.btnDisabled]}
                      onPress={clock.handleClockIn}
                      disabled={isClockedIn || clock.actionLoading}
                      activeOpacity={0.85}
                    >
                      {clock.actionLoading && !isClockedIn
                        ? <ActivityIndicator color={C.success} size="small" />
                        : <>
                            <Ionicons name="log-in-outline" size={17} color={C.success} />
                            <Text style={[s.clockActionText, { color: C.success }]}>Clock In</Text>
                          </>}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.clockActionBtn, s.clockOutBtn, (!isClockedIn || clock.actionLoading) && s.btnDisabled]}
                      onPress={clock.handleClockOut}
                      disabled={!isClockedIn || clock.actionLoading}
                      activeOpacity={0.85}
                    >
                      {clock.actionLoading && isClockedIn
                        ? <ActivityIndicator color={C.danger} size="small" />
                        : <>
                            <Ionicons name="log-out-outline" size={17} color={C.danger} />
                            <Text style={[s.clockActionText, { color: C.danger }]}>Clock Out</Text>
                          </>}
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={s.viewAttendanceLink}
                    onPress={() => router.push('/attendance' as any)}
                    activeOpacity={0.7}
                  >
                    <Text style={s.viewAttendanceLinkText}>View full attendance & calendar</Text>
                    <Ionicons name="chevron-forward" size={13} color={C.primary} />
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
                  { val: fmtHMS(summary.totalHours * 3600 + clock.timerSeconds), label: 'Hours', color: C.primary, bg: C.primaryBg, icon: 'timer-outline' as const },
                ].map((item) => (
                  <TouchableOpacity
                    key={item.label}
                    style={s.summaryCard}
                    onPress={() => router.push('/attendance' as any)}
                    activeOpacity={0.75}
                  >
                    <View style={[s.summaryIconWrap, { backgroundColor: item.bg }]}>
                      <Ionicons name={item.icon} size={16} color={item.color} />
                    </View>
                    <Text style={s.summaryVal}>{item.val}</Text>
                    <Text style={s.summaryLbl}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </AnimatedCard>
          </>
        )}

        {/* ── Quick Actions ─────────────────────────────────────────────── */}
        <AnimatedCard delay={250}>
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

        {/* ── Announcements banner ────────────────────────────────────── */}
        <AnnouncementBanner />

        {/* ── Announcements & Updates ──────────────────────────────────── */}
        <AnimatedCard delay={300}>
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
                  style={[s.updateCard, !n.is_read && s.updateCardUnread]}
                  onPress={() => handleOpenUpdate(n)}
                  activeOpacity={0.85}
                >
                  <View style={[s.updateIconWrap, !n.is_read && { backgroundColor: C.primaryBg }]}>
                    <Ionicons name={UPDATE_ICON[n.type] || 'notifications-outline'} size={17} color={C.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.updateTitle} numberOfLines={1}>{n.title}</Text>
                    {!!n.body && <Text style={s.updateBody} numberOfLines={2}>{n.body}</Text>}
                    <Text style={s.updateTime}>{fmtDate(n.created_at)}</Text>
                  </View>
                  {!n.is_read && <View style={s.updateDot} />}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </AnimatedCard>

        {/* ── Holidays (lower priority — informational, not actionable) ──── */}
        <HolidayBanner />

        {/* ── More Tools ───────────────────────────────────────────────── */}
        <AnimatedCard delay={350}>
            <View style={s.sectionHeaderRow}>
              <Text style={[s.sectionLabel, { marginTop: 0, paddingHorizontal: 0 }]}>More Tools</Text>
              <TouchableOpacity onPress={() => router.push('/more' as any)} activeOpacity={0.7}>
                <Text style={s.seeAllText}>See all</Text>
              </TouchableOpacity>
            </View>

            <View style={s.moreStatsRow}>
              {showAdvanceCard && (
                <View style={s.moreStatCard}>
                  <View style={[s.moreStatIconWrap, { backgroundColor: C.dangerBg }]}>
                    <Ionicons name="wallet-outline" size={16} color={C.danger} />
                  </View>
                  <Text style={s.moreStatLabel}>Advance Balance</Text>
                  <Text style={s.moreStatVal}>{fmt(advanceBalance)}</Text>
                </View>
              )}
              <TouchableOpacity style={s.moreStatCard} onPress={() => router.push('/more' as any)} activeOpacity={0.85}>
                <View style={[s.moreStatIconWrap, { backgroundColor: C.tealBg }]}>
                  <Ionicons name="swap-horizontal-outline" size={16} color={C.teal} />
                </View>
                <Text style={s.moreStatLabel}>Comp-Off Balance</Text>
                <Text style={s.moreStatVal}>{profile?.comp_off_balance || 0}</Text>
              </TouchableOpacity>
            </View>

            {visibleTools.length > 0 && (
              <View style={s.moreToolsGrid}>
                {visibleTools.map((t) => (
                  <TouchableOpacity key={t.route} style={s.moreToolCard} onPress={() => router.push(t.route as any)} activeOpacity={0.85}>
                    <View style={[s.moreToolIconWrap, { backgroundColor: t.bg }]}>
                      <Ionicons name={t.icon} size={20} color={t.color} />
                    </View>
                    <Text style={s.moreToolLabel}>{t.label}</Text>
                    <Text style={s.moreToolDesc} numberOfLines={2}>{t.desc}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
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
  liveClockRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingBottom: 8,
  },
  liveClockText: { fontSize: 12.5, fontWeight: '600', color: C.muted, fontVariant: ['tabular-nums'] },
  lastPunchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingBottom: 10,
  },
  lastPunchText: { fontSize: 12.5, color: C.muted },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingBottom: 8 },
  locationRowText: { fontSize: 11, color: C.muted, flexShrink: 1 },
  clockActionRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, marginTop: 2 },
  clockActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 14, paddingVertical: 12, gap: 7, borderWidth: 1,
  },
  clockInBtn: { backgroundColor: C.successBg, borderColor: 'rgba(16,185,129,0.3)' },
  clockOutBtn: { backgroundColor: C.dangerBg, borderColor: 'rgba(239,68,68,0.25)' },
  clockActionText: { fontSize: 13.5, fontWeight: '800' },
  btnDisabled: { opacity: 0.35 },
  viewAttendanceLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 12, marginHorizontal: 12, marginTop: 4, marginBottom: 4,
  },
  viewAttendanceLinkText: { fontSize: 12.5, fontWeight: '700', color: C.primary },

  // Section label
  sectionLabel: {
    fontSize: 11.5, fontWeight: '700', color: C.muted,
    textTransform: 'uppercase', letterSpacing: 1,
    paddingHorizontal: 20, marginTop: 22, marginBottom: 10,
  },

  // Summary
  summaryRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  summaryCard: {
    flex: 1, backgroundColor: C.surface, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 6,
    alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  summaryIconWrap: {
    width: 30, height: 30, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  summaryVal: { fontSize: 17, fontWeight: '900', color: C.text },
  summaryLbl: { fontSize: 9.5, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.3 },

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

  // More Tools
  moreStatsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 12 },
  moreStatCard: {
    flex: 1, backgroundColor: C.bg, borderRadius: 16, padding: 12, gap: 3,
  },
  moreStatIconWrap: {
    width: 30, height: 30, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  moreStatLabel: { fontSize: 11, color: C.muted, fontWeight: '600' },
  moreStatVal: { fontSize: 15, fontWeight: '800', color: C.text },
  moreToolsGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 16, gap: 10,
  },
  moreToolCard: {
    width: '47%',
    backgroundColor: C.surface, borderRadius: 16,
    padding: 12, gap: 3,
    borderWidth: 1, borderColor: C.border,
  },
  moreToolIconWrap: {
    width: 36, height: 36, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  moreToolLabel: { fontSize: 13, fontWeight: '700', color: C.text },
  moreToolDesc: { fontSize: 11, color: C.muted, lineHeight: 14 },
});
