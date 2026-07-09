import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Animated, Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as StoreReview from 'expo-store-review';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import {
  fetchMyMonthAttendance,
  clockIn as svcClockIn,
  clockOut as svcClockOut,
} from '@/services/attendanceService';
import { showToast } from '@/components/Toast';
import {
  todayStr, dateStr, timeStr, fmtTime12, diffHours, fmtDuration, monthLabel,
  calculateDistance, fmtLiveClock, fmtLiveDate,
} from '@/lib/helpers';
import { presentLocalNotification } from '@/lib/pushNotifications';

import { Colors as C } from '@/constants/Colors';

const CLOCK_OUT_COUNT_KEY = 'clock_out_count';

async function maybeAskReview() {
  try {
    const raw = await AsyncStorage.getItem(CLOCK_OUT_COUNT_KEY);
    const count = parseInt(raw || '0', 10) + 1;
    await AsyncStorage.setItem(CLOCK_OUT_COUNT_KEY, String(count));
    if (count === 3 && await StoreReview.hasAction()) await StoreReview.requestReview();
  } catch {}
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS_COLORS: Record<string, string> = {
  Present: C.success,
  Late: C.warning,
  'Half Day': '#F97316',
  Absent: C.danger,
  Leave: C.purple,
};

// ── Live clock pulse ──────────────────────────────────────────────────────────
function StatusPulse({ active }: { active: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.8, duration: 800, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active]);

  return (
    <View style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{
        position: 'absolute',
        width: 14, height: 14, borderRadius: 7,
        backgroundColor: active ? C.success : C.muted,
        opacity: 0.3,
        transform: [{ scale }],
      }} />
      <View style={{
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: active ? C.success : C.muted,
      }} />
    </View>
  );
}

export default function AttendanceScreen() {
  const { profile, tenant } = useAuth();
  const [attMonth, setAttMonth] = useState(new Date().getMonth());
  const [attYear, setAttYear] = useState(new Date().getFullYear());
  const [myRecords, setMyRecords] = useState<any[]>([]);
  const [myPunches, setMyPunches] = useState<any>({});
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [locationStatus, setLocationStatus] = useState('Loading…');
  const [liveClock, setLiveClock] = useState('');
  const [liveDate, setLiveDate] = useState('');
  const [timerDisplay, setTimerDisplay] = useState('00:00:00');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const btnScale = useRef(new Animated.Value(1)).current;

  const fetchData = useCallback(async () => {
    if (!profile || !tenant) return;
    setLoading(true);
    const { data } = await fetchMyMonthAttendance(profile.id, attYear, attMonth);
    setMyRecords(data);
    const todayRec = data.find((r: any) => r.date === todayStr());
    if (todayRec) {
      const ins = (todayRec.punches || []).filter((p: any) => p.punch_type === 'in').length;
      const outs = (todayRec.punches || []).filter((p: any) => p.punch_type === 'out').length;
      setIsClockedIn(ins > outs);
      setMyPunches(todayRec);
    } else {
      setIsClockedIn(false);
      setMyPunches({});
    }
    setLoading(false);
  }, [profile, tenant, attMonth, attYear]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const tick = () => { setLiveClock(fmtLiveClock(new Date())); setLiveDate(fmtLiveDate(new Date())); };
    tick();
    clockRef.current = setInterval(tick, 1000);
    return () => { if (clockRef.current) clearInterval(clockRef.current); };
  }, []);

  useEffect(() => {
    const tickTimer = () => {
      const todayRec = myPunches;
      if (!todayRec?.punches?.length) { setTimerDisplay('00:00:00'); return; }
      const sorted = [...todayRec.punches].sort((a: any, b: any) => a.punch_time.localeCompare(b.punch_time));
      let totalSecs = 0;
      const ins = sorted.filter((p: any) => p.punch_type === 'in');
      const outs = sorted.filter((p: any) => p.punch_type === 'out');
      for (let i = 0; i < ins.length; i++) {
        const outTime = outs[i]?.punch_time || timeStr(new Date());
        totalSecs += diffHours(ins[i].punch_time, outTime) * 3600;
      }
      const h = Math.floor(totalSecs / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      const sec = Math.floor(totalSecs % 60);
      setTimerDisplay(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`);
    };
    tickTimer();
    timerRef.current = setInterval(tickTimer, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [myPunches]);

  useEffect(() => {
    if (!tenant) return;
    setLocationStatus(
      tenant.geofence_lat && tenant.geofence_lng
        ? 'Tap clock in to verify location'
        : 'Geofencing not configured',
    );
  }, [tenant]);

  const checkGeofence = useCallback(async (): Promise<{ loc: { lat: number; lng: number } | null; msg: string }> => {
    if (!tenant?.geofence_lat || !tenant?.geofence_lng) {
      setLocationStatus('Geofencing not configured');
      return { loc: { lat: 0, lng: 0 }, msg: 'Geofencing not configured' };
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      const msg = 'Location permission denied';
      setLocationStatus(msg);
      return { loc: null, msg };
    }
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const dist = calculateDistance(pos.coords.latitude, pos.coords.longitude, tenant.geofence_lat, tenant.geofence_lng);
      const radius = tenant.geofence_radius || 200;
      if (dist > radius) {
        const msg = `Outside office area (${Math.round(dist)}m away)`;
        setLocationStatus(msg);
        return { loc: null, msg };
      }
      setLocationStatus('Within office area ✓');
      return { loc: { lat: pos.coords.latitude, lng: pos.coords.longitude }, msg: 'Within office area ✓' };
    } catch {
      const msg = 'Unable to get location — check GPS';
      setLocationStatus(msg);
      return { loc: null, msg };
    }
  }, [tenant]);

  const animateBtn = () => {
    Animated.sequence([
      Animated.timing(btnScale, { toValue: 0.95, duration: 100, useNativeDriver: true }),
      Animated.timing(btnScale, { toValue: 1, duration: 200, easing: Easing.out(Easing.back(2)), useNativeDriver: true }),
    ]).start();
  };

  const handleClockIn = async () => {
    if (!profile || !tenant) { showToast('Account setup incomplete.', 'error'); return; }
    if (isClockedIn) { showToast('Already clocked in!', 'warning'); return; }
    animateBtn();
    setActionLoading(true);
    const { loc, msg } = await checkGeofence();
    if (loc === null) { showToast(msg, 'error'); setActionLoading(false); return; }
    try {
      await svcClockIn(tenant.id, profile.id, tenant, loc.lat !== 0 ? loc : null);
      const inTime = fmtTime12(timeStr(new Date()));
      showToast(`Clocked in at ${inTime}`, 'success');
      presentLocalNotification('Clocked In ✓', `You clocked in at ${inTime}`, { type: 'clock_in' });
      fetchData();
    } catch (err: any) {
      showToast('Clock in failed: ' + err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleClockOut = async () => {
    if (!isClockedIn) { showToast('Not clocked in!', 'warning'); return; }
    animateBtn();
    setActionLoading(true);
    const { loc, msg } = await checkGeofence();
    if (loc === null) { showToast(msg, 'error'); setActionLoading(false); return; }
    try {
      const { total } = await svcClockOut(profile!.id, loc.lat !== 0 ? loc : null);
      const worked = fmtDuration(total);
      showToast(`Clocked out. Worked ${worked}`, 'success');
      presentLocalNotification('Clocked Out', `You worked ${worked} today.`, { type: 'clock_out' });
      fetchData();
      maybeAskReview();
    } catch (err: any) {
      showToast('Clock out failed: ' + err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const changeMonth = (delta: number) => {
    let m = attMonth + delta, y = attYear;
    if (m > 11) { m = 0; y++; } if (m < 0) { m = 11; y--; }
    setAttMonth(m); setAttYear(y);
  };

  const renderCalendar = () => {
    const firstDay = new Date(attYear, attMonth, 1).getDay();
    const daysInMonth = new Date(attYear, attMonth + 1, 0).getDate();
    const today = new Date();
    const cells: React.ReactNode[] = [];

    WEEKDAYS.forEach((d) => (
      cells.push(<Text key={'h' + d} style={s.calHeader}>{d}</Text>)
    ));

    for (let i = 0; i < firstDay; i++) cells.push(<View key={'e' + i} style={s.calCell} />);

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(attYear, attMonth, d);
      const ds = dateStr(date);
      const isToday = ds === todayStr();
      const isFuture = date > today;
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const rec = myRecords.find((r) => r.date === ds);

      let bg = 'transparent';
      let textColor = C.text;

      if (isToday) bg = C.primary;
      else if (isFuture) textColor = '#CBD5E1';
      else if (isWeekend) textColor = C.muted;
      else if (rec) {
        bg = (STATUS_COLORS[rec.status] || C.primary) + '22';
        textColor = STATUS_COLORS[rec.status] || C.text;
      } else if (!isFuture) {
        bg = C.danger + '15';
        textColor = C.danger;
      }

      cells.push(
        <View key={d} style={[s.calCell, { backgroundColor: bg, borderRadius: 10 }]}>
          <Text style={[s.calDay, { color: isToday ? '#fff' : textColor, fontWeight: isToday ? '800' : '400' }]}>{d}</Text>
          {rec && !isToday && (
            <View style={[s.calDot, { backgroundColor: STATUS_COLORS[rec?.status] || C.primary }]} />
          )}
        </View>
      );
    }
    return cells;
  };

  const summary = { present: 0, absent: 0, halfDay: 0, late: 0, leaves: 0, totalHours: 0 };
  const today = new Date();
  for (let d = 1; d <= new Date(attYear, attMonth + 1, 0).getDate(); d++) {
    const date = new Date(attYear, attMonth, d);
    if (date > today || date.getDay() === 0 || date.getDay() === 6) continue;
    const rec = myRecords.find((r) => r.date === dateStr(date));
    if (!rec?.status) { if (date < today) summary.absent++; continue; }
    if (rec.status === 'Present') summary.present++;
    else if (rec.status === 'Late') { summary.late++; summary.present++; }
    else if (rec.status === 'Half Day') summary.halfDay++;
    else if (rec.status === 'Leave') summary.leaves++;
    else if (rec.status === 'Absent') summary.absent++;
    summary.totalHours += rec.total_hours || 0;
  }

  const statusText = isClockedIn ? 'Currently Working' : myPunches?.punches?.length ? 'Clocked Out' : 'Not Clocked In';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}>

        {/* ── Page header ── */}
        <View style={s.pageHeader}>
          <Text style={s.pageTitle}>Attendance</Text>
          <Text style={s.pageSubtitle}>{monthLabel(attMonth, attYear)}</Text>
        </View>

        {/* ── Clock Widget ── */}
        <View style={s.clockWidget}>
          <View style={s.clockDecor1} />
          <View style={s.clockDecor2} />

          {/* Time + Status row */}
          <View style={s.clockTopRow}>
            <View style={s.clockLeft}>
              <Text style={s.liveTime}>{liveClock}</Text>
              <Text style={s.liveDate}>{liveDate}</Text>
              <View style={s.statusRow}>
                <StatusPulse active={isClockedIn} />
                <Text style={s.statusText}>{statusText}</Text>
              </View>
              <View style={s.locationRow}>
                <Ionicons name="location-outline" size={11} color="rgba(255,255,255,0.4)" />
                <Text style={s.locationText} numberOfLines={1}>{locationStatus}</Text>
              </View>
            </View>
            <View style={s.timerBox}>
              <Text style={s.timerLabel}>TODAY'S HOURS</Text>
              <Text style={s.timerValue}>{timerDisplay}</Text>
              {isClockedIn && (
                <View style={s.timerActivePill}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.success }} />
                  <Text style={s.timerActiveTxt}>Live</Text>
                </View>
              )}
            </View>
          </View>

          {/* Divider */}
          <View style={s.widgetDivider} />

          {/* Clock buttons */}
          <View style={s.clockBtns}>
            <Animated.View style={[{ flex: 1 }, { transform: [{ scale: btnScale }] }]}>
              <TouchableOpacity
                style={[s.clockInBtn, (isClockedIn || actionLoading) && s.btnDisabled]}
                onPress={handleClockIn}
                disabled={isClockedIn || actionLoading}
                activeOpacity={0.85}
              >
                {actionLoading && !isClockedIn
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <View style={s.clockBtnIcon}>
                        <Ionicons name="log-in-outline" size={20} color={C.success} />
                      </View>
                      <Text style={s.clockBtnText}>Clock In</Text>
                    </>}
              </TouchableOpacity>
            </Animated.View>

            <Animated.View style={[{ flex: 1 }, { transform: [{ scale: btnScale }] }]}>
              <TouchableOpacity
                style={[s.clockOutBtn, (!isClockedIn || actionLoading) && s.btnDisabled]}
                onPress={handleClockOut}
                disabled={!isClockedIn || actionLoading}
                activeOpacity={0.85}
              >
                {actionLoading && isClockedIn
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <View style={[s.clockBtnIcon, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
                        <Ionicons name="log-out-outline" size={20} color={C.danger} />
                      </View>
                      <Text style={[s.clockBtnText, { color: C.danger }]}>Clock Out</Text>
                    </>}
              </TouchableOpacity>
            </Animated.View>
          </View>
        </View>

        {/* ── Summary strip ── */}
        <View style={s.summaryStrip}>
          {[
            { val: summary.present, lbl: 'Present', color: C.success },
            { val: summary.absent, lbl: 'Absent', color: C.danger },
            { val: summary.halfDay, lbl: 'Half Day', color: '#F97316' },
            { val: summary.late, lbl: 'Late', color: C.warning },
            { val: summary.leaves, lbl: 'Leaves', color: C.purple },
            { val: fmtDuration(summary.totalHours), lbl: 'Hrs', color: C.primary },
          ].map((item, idx) => (
            <View key={item.lbl} style={[s.summaryItem, idx < 5 && s.summaryItemBorder]}>
              <Text style={[s.summaryVal, { color: item.color }]}>{item.val}</Text>
              <Text style={s.summaryLbl}>{item.lbl}</Text>
            </View>
          ))}
        </View>

        {/* ── Calendar ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <View style={s.cardTitleRow}>
              <View style={s.cardTitleDot} />
              <Text style={s.cardTitle}>Monthly Calendar</Text>
            </View>
            <View style={s.monthNav}>
              <TouchableOpacity onPress={() => changeMonth(-1)} style={s.navBtn}>
                <Ionicons name="chevron-back" size={16} color={C.primary} />
              </TouchableOpacity>
              <Text style={s.monthLabel}>{monthLabel(attMonth, attYear)}</Text>
              <TouchableOpacity onPress={() => changeMonth(1)} style={s.navBtn}>
                <Ionicons name="chevron-forward" size={16} color={C.primary} />
              </TouchableOpacity>
            </View>
          </View>
          {loading ? (
            <ActivityIndicator color={C.primary} style={{ padding: 24 }} />
          ) : (
            <View style={s.calendar}>{renderCalendar()}</View>
          )}
          {/* Legend */}
          <View style={s.legend}>
            {Object.entries(STATUS_COLORS).map(([key, color]) => (
              <View key={key} style={s.legendItem}>
                <View style={[s.legendDot, { backgroundColor: color }]} />
                <Text style={s.legendText}>{key}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Today's Timeline ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <View style={s.cardTitleRow}>
              <View style={[s.cardTitleDot, { backgroundColor: C.success }]} />
              <Text style={s.cardTitle}>Today's Timeline</Text>
            </View>
          </View>
          {!myPunches?.punches?.length ? (
            <View style={s.emptyRow}>
              <Ionicons name="time-outline" size={28} color={C.muted} />
              <Text style={s.emptyText}>No punches recorded today.</Text>
            </View>
          ) : (
            <View style={s.timeline}>
              {[...myPunches.punches]
                .sort((a: any, b: any) => a.punch_time.localeCompare(b.punch_time))
                .map((p: any, i: number, arr: any[]) => (
                  <View key={p.id || i} style={s.timelineItem}>
                    <View style={s.timelineLeft}>
                      <View style={[s.tlDot, { backgroundColor: p.punch_type === 'in' ? C.success : C.danger }]} />
                      {i < arr.length - 1 && <View style={s.tlLine} />}
                    </View>
                    <View style={s.timelineRight}>
                      <Text style={s.tlTime}>{fmtTime12(p.punch_time)}</Text>
                      <View style={[s.tlTypePill, { backgroundColor: p.punch_type === 'in' ? C.successBg : C.dangerBg }]}>
                        <Text style={[s.tlType, { color: p.punch_type === 'in' ? C.success : C.danger }]}>
                          {p.punch_type === 'in' ? (i === 0 ? 'Clock In' : 'Resume') : 'Clock Out'}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.dark },
  scroll: { flex: 1, backgroundColor: C.bg },
  pageHeader: {
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14,
    backgroundColor: C.dark,
  },
  pageTitle: { fontSize: 24, fontWeight: '900', color: '#fff' },
  pageSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 2 },

  // Clock widget
  clockWidget: {
    marginHorizontal: 14, marginBottom: 14, borderRadius: 24,
    backgroundColor: C.dark,
    padding: 20, overflow: 'hidden',
    shadowColor: C.primary, shadowOpacity: 0.25, shadowRadius: 20, elevation: 10,
    borderWidth: 1, borderColor: 'rgba(108,92,231,0.2)',
  },
  clockDecor1: {
    position: 'absolute', top: -50, right: -50,
    width: 160, height: 160, borderRadius: 80,
    backgroundColor: C.primary, opacity: 0.1,
  },
  clockDecor2: {
    position: 'absolute', bottom: -30, left: -30,
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: C.primaryLight, opacity: 0.06,
  },
  clockTopRow: { flexDirection: 'row', gap: 14, marginBottom: 16 },
  clockLeft: { flex: 1 },
  liveTime: { fontSize: 32, fontWeight: '900', color: '#fff', letterSpacing: 1.5, fontVariant: ['tabular-nums'] },
  liveDate: { fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 },
  statusText: { fontSize: 12.5, color: 'rgba(255,255,255,0.8)', fontWeight: '600' },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  locationText: { fontSize: 11, color: 'rgba(255,255,255,0.4)', flexShrink: 1 },

  timerBox: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 18, paddingVertical: 14, paddingHorizontal: 14, minWidth: 120,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  timerLabel: { fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  timerValue: { fontSize: 22, fontWeight: '900', color: '#fff', fontVariant: ['tabular-nums'], marginTop: 6, letterSpacing: 1 },
  timerActivePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(16,185,129,0.2)', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3, marginTop: 6,
  },
  timerActiveTxt: { fontSize: 10, color: C.success, fontWeight: '700' },

  widgetDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginBottom: 16 },

  clockBtns: { flexDirection: 'row', gap: 10 },
  clockInBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(16,185,129,0.15)',
    borderRadius: 14, paddingVertical: 14, gap: 8,
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)',
  },
  clockOutBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 14, paddingVertical: 14, gap: 8,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)',
  },
  clockBtnIcon: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: 'rgba(16,185,129,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  clockBtnText: { fontSize: 14, fontWeight: '800', color: C.success },
  btnDisabled: { opacity: 0.35 },

  // Summary strip
  summaryStrip: {
    flexDirection: 'row', backgroundColor: C.surface,
    marginHorizontal: 14, borderRadius: 18,
    paddingVertical: 14, paddingHorizontal: 6, marginBottom: 14,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryItemBorder: { borderRightWidth: 1, borderRightColor: C.border },
  summaryVal: { fontSize: 16, fontWeight: '900' },
  summaryLbl: { fontSize: 9, color: C.muted, marginTop: 3, fontWeight: '600', textTransform: 'uppercase' },

  // Card
  card: {
    marginHorizontal: 14, marginBottom: 14, backgroundColor: C.surface,
    borderRadius: 20, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 3,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitleDot: { width: 4, height: 18, borderRadius: 2, backgroundColor: C.primary },
  cardTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navBtn: {
    width: 30, height: 30, borderRadius: 10,
    backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center',
  },
  monthLabel: { fontSize: 13, color: C.text, fontWeight: '600', minWidth: 100, textAlign: 'center' },

  // Calendar
  calendar: { flexDirection: 'row', flexWrap: 'wrap' },
  calHeader: { width: '14.28%', textAlign: 'center', fontSize: 10, color: C.muted, fontWeight: '700', paddingVertical: 6, textTransform: 'uppercase' },
  calCell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 1 },
  calDay: { fontSize: 12, color: C.text },
  calDot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, color: C.muted, fontWeight: '500' },

  // Timeline
  emptyRow: { alignItems: 'center', paddingVertical: 16, gap: 8 },
  emptyText: { color: C.muted, fontSize: 13 },
  timeline: { gap: 0 },
  timelineItem: { flexDirection: 'row', gap: 12, paddingBottom: 4 },
  timelineLeft: { alignItems: 'center', width: 20 },
  tlDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: C.surface, marginTop: 4 },
  tlLine: { width: 2, flex: 1, backgroundColor: C.border, marginTop: 4, marginBottom: 4, borderRadius: 1, minHeight: 20 },
  timelineRight: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 16 },
  tlTime: { fontSize: 14, fontWeight: '700', color: C.text, width: 84, fontVariant: ['tabular-nums'] },
  tlTypePill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  tlType: { fontSize: 12, fontWeight: '700' },
});
