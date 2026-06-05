
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useAuth } from '@/context/AuthContext';
import {
  fetchMyMonthAttendance,
  clockIn as svcClockIn,
  clockOut as svcClockOut,
} from '@/services/attendanceService';
import { showToast } from '@/components/Toast';
import {
  todayStr, dateStr, timeStr, fmtTime12, diffHours, fmtDuration, monthLabel, calculateDistance,
} from '@/lib/helpers';
import { useNotification } from '@/lib/notifications';

const C = {
  primary: '#00AEEF',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  text: '#1E293B',
  muted: '#94A3B8',
  border: '#E2E8F0',
  success: '#22C55E',
  danger: '#EF4444',
  warning: '#F59E0B',
  purple: '#8B5CF6',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS_COLORS: Record<string, string> = {
  Present: C.success,
  Late: C.warning,
  'Half Day': '#F97316',
  Absent: C.danger,
  Leave: C.purple,
};

export default function AttendanceScreen() {
  const { profile, tenant } = useAuth();
  const { notify } = useNotification();
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

  // Live clock
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setLiveClock(now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
      setLiveDate(now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    };
    tick();
    clockRef.current = setInterval(tick, 1000);
    return () => { if (clockRef.current) clearInterval(clockRef.current); };
  }, []);

  // Work timer
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

  // Set location status label once tenant is loaded
  useEffect(() => {
    if (!tenant) return;
    setLocationStatus(
      tenant.geofence_lat && tenant.geofence_lng
        ? 'Tap clock in to verify location'
        : 'Geofencing not configured',
    );
  }, [tenant]);

  // Returns { loc, msg } — loc is null when blocked, { lat:0, lng:0 } when geofencing disabled
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
      const dist = calculateDistance(
        pos.coords.latitude, pos.coords.longitude,
        tenant.geofence_lat, tenant.geofence_lng,
      );
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

  const handleClockIn = async () => {
    if (!profile || !tenant) { showToast('Account setup incomplete.', 'error'); return; }
    if (isClockedIn) { showToast('Already clocked in!', 'warning'); return; }
    setActionLoading(true);
    const { loc, msg } = await checkGeofence();
    if (loc === null) { showToast(msg, 'error'); setActionLoading(false); return; }
    try {
      await svcClockIn(tenant.id, profile.id, tenant, loc.lat !== 0 ? loc : null);
      const inTime = fmtTime12(timeStr(new Date()));
      showToast(`Clocked in at ${inTime}`, 'success');
      notify('Clocked In ✓', `You clocked in at ${inTime}`, 'success');
      fetchData();
    } catch (err: any) {
      showToast('Clock in failed: ' + err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleClockOut = async () => {
    if (!isClockedIn) { showToast('Not clocked in!', 'warning'); return; }
    setActionLoading(true);
    const { loc, msg } = await checkGeofence();
    if (loc === null) { showToast(msg, 'error'); setActionLoading(false); return; }
    try {
      const { total } = await svcClockOut(profile!.id, loc.lat !== 0 ? loc : null);
      const worked = fmtDuration(total);
      showToast(`Clocked out. Worked ${worked}`, 'success');
      notify('Clocked Out', `You worked ${worked} today.`, 'info');
      fetchData();
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

  // Calendar
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
      let statusDot = '';

      if (isToday) bg = C.primary;
      else if (isFuture) textColor = '#CBD5E1';
      else if (isWeekend) textColor = C.muted;
      else if (rec) {
        bg = (STATUS_COLORS[rec.status] || C.primary) + '25';
        textColor = STATUS_COLORS[rec.status] || C.text;
        statusDot = rec.status?.[0] || '';
      } else if (!isFuture) {
        bg = C.danger + '15';
        textColor = C.danger;
      }

      cells.push(
        <View key={d} style={[s.calCell, { backgroundColor: bg, borderRadius: 8 }]}>
          <Text style={[s.calDay, { color: isToday ? '#fff' : textColor, fontWeight: isToday ? '800' : '400' }]}>{d}</Text>
          {!!statusDot && !isToday && (
            <View style={[s.calDot, { backgroundColor: STATUS_COLORS[rec?.status] || C.primary }]} />
          )}
        </View>
      );
    }
    return cells;
  };

  // Summary
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

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Page title */}
        <View style={s.pageHeader}>
          <Text style={s.pageTitle}>My Attendance</Text>
          <Text style={s.pageSubtitle}>{monthLabel(attMonth, attYear)}</Text>
        </View>

        {/* Clock widget */}
        <View style={s.clockWidget}>
          <View style={s.clockTop}>
            <View style={s.clockInfo}>
              <Text style={s.clockTime}>{liveClock}</Text>
              <Text style={s.clockDate} numberOfLines={1}>{liveDate}</Text>
              <View style={s.clockStatus}>
                <View style={[s.pulse, { backgroundColor: isClockedIn ? '#4ADE80' : '#94A3B8' }]} />
                <Text style={s.clockStatusText}>
                  {isClockedIn ? 'Currently Working' : myPunches?.punches?.length ? 'Clocked Out' : 'Not Clocked In'}
                </Text>
              </View>
              <View style={s.locationRow}>
                <Ionicons name="location-outline" size={11} color="rgba(255,255,255,0.5)" />
                <Text style={s.locationText} numberOfLines={1}>{locationStatus}</Text>
              </View>
            </View>
            <View style={s.timerWrap}>
              <Text style={s.timerLabel}>Today's Hours</Text>
              <Text style={s.timerText}>{timerDisplay}</Text>
            </View>
          </View>

          <View style={s.divider} />

          <View style={s.clockBtns}>
            <TouchableOpacity
              style={[s.clockBtn, s.clockInBtn, (isClockedIn || actionLoading) && s.btnDisabled]}
              onPress={handleClockIn}
              disabled={isClockedIn || actionLoading}
            >
              {actionLoading && !isClockedIn
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Ionicons name="log-in-outline" size={18} color="#fff" /><Text style={s.clockBtnText}> Clock In</Text></>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.clockBtn, s.clockOutBtn, (!isClockedIn || actionLoading) && s.btnDisabled]}
              onPress={handleClockOut}
              disabled={!isClockedIn || actionLoading}
            >
              {actionLoading && isClockedIn
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Ionicons name="log-out-outline" size={18} color="#fff" /><Text style={s.clockBtnText}> Clock Out</Text></>}
            </TouchableOpacity>
          </View>
        </View>

        {/* Summary bar */}
        <View style={s.summaryBar}>
          {[
            { val: summary.present, lbl: 'Present', color: C.success },
            { val: summary.absent, lbl: 'Absent', color: C.danger },
            { val: summary.halfDay, lbl: 'Half Day', color: '#F97316' },
            { val: summary.late, lbl: 'Late', color: C.warning },
            { val: summary.leaves, lbl: 'Leaves', color: C.purple },
            { val: fmtDuration(summary.totalHours), lbl: 'Hrs', color: C.primary },
          ].map((item) => (
            <View key={item.lbl} style={s.summaryItem}>
              <Text style={[s.summaryVal, { color: item.color }]}>{item.val}</Text>
              <Text style={s.summaryLbl}>{item.lbl}</Text>
            </View>
          ))}
        </View>

        {/* Month selector + calendar */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>Monthly Calendar</Text>
            <View style={s.monthNav}>
              <TouchableOpacity onPress={() => changeMonth(-1)} style={s.navBtn}>
                <Ionicons name="chevron-back" size={18} color={C.primary} />
              </TouchableOpacity>
              <Text style={s.monthLabel}>{monthLabel(attMonth, attYear)}</Text>
              <TouchableOpacity onPress={() => changeMonth(1)} style={s.navBtn}>
                <Ionicons name="chevron-forward" size={18} color={C.primary} />
              </TouchableOpacity>
            </View>
          </View>
          {loading ? (
            <ActivityIndicator color={C.primary} style={{ padding: 24 }} />
          ) : (
            <View style={s.calendar}>
              {renderCalendar()}
            </View>
          )}
        </View>

        {/* Today's timeline */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>Today's Timeline</Text>
          </View>
          {!myPunches?.punches?.length ? (
            <Text style={s.emptyText}>No punches recorded today.</Text>
          ) : (
            <View style={s.timeline}>
              {[...myPunches.punches]
                .sort((a: any, b: any) => a.punch_time.localeCompare(b.punch_time))
                .map((p: any, i: number) => (
                  <View key={p.id || i} style={s.timelineItem}>
                    <View style={[s.timelineDot, { backgroundColor: p.punch_type === 'in' ? C.success : C.danger }]} />
                    <Text style={s.timelineTime}>{fmtTime12(p.punch_time)}</Text>
                    <Text style={s.timelineLabel}>{p.punch_type === 'in' ? (i === 0 ? 'Clock In' : 'Resume') : 'Clock Out'}</Text>
                  </View>
                ))}
            </View>
          )}
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#EFF6FF' },
  scroll: { flex: 1, backgroundColor: '#F8FAFC' },
  pageHeader: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, backgroundColor: '#EFF6FF' },
  pageTitle: { fontSize: 22, fontWeight: '800', color: C.text },
  pageSubtitle: { fontSize: 13, color: C.muted, marginTop: 2 },
  clockWidget: {
    marginHorizontal: 16, marginBottom: 16, borderRadius: 20,
    backgroundColor: '#0F172A', padding: 20,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, elevation: 8,
  },
  clockTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  clockInfo: { flex: 1 },
  clockTime: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  clockDate: { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 3 },
  clockStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  pulse: { width: 8, height: 8, borderRadius: 4 },
  clockStatusText: { fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  locationText: { fontSize: 11, color: 'rgba(255,255,255,0.5)', flexShrink: 1 },
  timerWrap: {
    alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, flexShrink: 0,
  },
  timerText: { fontSize: 20, fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'], marginTop: 4 },
  timerLabel: { fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 16 },
  clockBtns: { flexDirection: 'row', gap: 12 },
  clockBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 13, borderRadius: 12, gap: 6,
  },
  clockInBtn: { backgroundColor: C.success },
  clockOutBtn: { backgroundColor: C.danger },
  btnDisabled: { opacity: 0.4 },
  clockBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  summaryBar: {
    flexDirection: 'row', backgroundColor: C.surface, marginHorizontal: 16,
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: 8, marginBottom: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 3,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryVal: { fontSize: 15, fontWeight: '800' },
  summaryLbl: { fontSize: 10, color: C.muted, marginTop: 2 },
  card: {
    marginHorizontal: 16, marginBottom: 16, backgroundColor: C.surface,
    borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: C.text, flex: 1 },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  navBtn: { padding: 4 },
  monthLabel: { fontSize: 13, color: C.text, fontWeight: '600', minWidth: 100, textAlign: 'center' },
  calendar: { flexDirection: 'row', flexWrap: 'wrap' },
  calHeader: { width: '14.28%', textAlign: 'center', fontSize: 10, color: C.muted, fontWeight: '600', paddingVertical: 4 },
  calCell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2 },
  calDay: { fontSize: 12, fontWeight: '400', color: C.text },
  calDot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
  emptyText: { color: C.muted, fontSize: 13, padding: 8 },
  timeline: { gap: 10 },
  timelineItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  timelineDot: { width: 10, height: 10, borderRadius: 5 },
  timelineTime: { fontSize: 14, fontWeight: '700', color: C.text, width: 80 },
  timelineLabel: { fontSize: 13, color: C.muted },
});
