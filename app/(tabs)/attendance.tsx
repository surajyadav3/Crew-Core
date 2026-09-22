import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Animated, Easing, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { useClockInOut } from '@/hooks/useClockInOut';
import { fetchMyMonthAttendance } from '@/services/attendanceService';
import { listHolidays } from '@/services/holidayService';
import { showToast } from '@/components/Toast';
import { todayStr, dateStr, fmtTime12, fmtHMS, fmtDate, monthLabel } from '@/lib/helpers';

import { Colors as C } from '@/constants/Colors';

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
  const clock = useClockInOut();
  const [attMonth, setAttMonth] = useState(new Date().getMonth());
  const [attYear, setAttYear] = useState(new Date().getFullYear());
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [myRecords, setMyRecords] = useState<any[]>([]);
  const [holidays, setHolidays] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const btnScale = useRef(new Animated.Value(1)).current;

  const fetchData = useCallback(async () => {
    if (!profile || !tenant) return;
    const { data, error } = await fetchMyMonthAttendance(profile.id, attYear, attMonth);
    if (error) { showToast('Could not load attendance records.', 'error'); return; }
    setMyRecords(data);
  }, [profile, tenant, attMonth, attYear]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    Promise.all([fetchData(), clock.refresh()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchData(), clock.refresh()]);
    setRefreshing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData]);

  useEffect(() => {
    if (!tenant) return;
    listHolidays(tenant.id).then(({ data, error }) => {
      if (error) { showToast('Could not load holidays.', 'error'); return; }
      setHolidays(data);
    });
  }, [tenant]);

  const animateBtn = () => {
    Animated.sequence([
      Animated.timing(btnScale, { toValue: 0.95, duration: 100, useNativeDriver: true }),
      Animated.timing(btnScale, { toValue: 1, duration: 200, easing: Easing.out(Easing.back(2)), useNativeDriver: true }),
    ]).start();
  };

  const handleClockIn = () => { animateBtn(); clock.handleClockIn(); };
  const handleClockOut = () => { animateBtn(); clock.handleClockOut(); };

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
      const holiday = holidays.find((h) => h.date === ds && h.status === 'Approved');
      const rec = myRecords.find((r) => r.date === ds);

      let bg = 'transparent';
      let textColor = C.text;

      if (isToday) bg = C.primary;
      else if (isFuture) textColor = '#CBD5E1';
      else if (holiday) { bg = C.teal + '22'; textColor = C.teal; }
      else if (isWeekend) textColor = C.muted;
      else if (rec) {
        bg = (STATUS_COLORS[rec.status] || C.primary) + '22';
        textColor = STATUS_COLORS[rec.status] || C.text;
      } else if (!isFuture) {
        bg = C.danger + '15';
        textColor = C.danger;
      }

      const isSelected = ds === selectedDate;

      cells.push(
        <TouchableOpacity
          key={d}
          style={[
            s.calCell,
            { backgroundColor: bg, borderRadius: 10 },
            isSelected && !isToday && s.calCellSelected,
          ]}
          onPress={() => setSelectedDate(ds)}
          disabled={isFuture}
          activeOpacity={0.6}
        >
          <Text style={[s.calDay, { color: isToday ? '#fff' : textColor, fontWeight: isToday ? '800' : '400' }]}>{d}</Text>
          {rec && !isToday && !holiday && (
            <View style={[s.calDot, { backgroundColor: STATUS_COLORS[rec?.status] || C.primary }]} />
          )}
        </TouchableOpacity>
      );
    }
    return cells;
  };

  const summary = { present: 0, absent: 0, halfDay: 0, late: 0, leaves: 0, totalHours: 0 };
  const today = new Date();
  for (let d = 1; d <= new Date(attYear, attMonth + 1, 0).getDate(); d++) {
    const date = new Date(attYear, attMonth, d);
    if (date > today || date.getDay() === 0 || date.getDay() === 6) continue;
    const ds = dateStr(date);
    if (holidays.find((h) => h.date === ds && h.status === 'Approved')) continue;
    const rec = myRecords.find((r) => r.date === ds);
    if (!rec?.status) { if (date < today) summary.absent++; continue; }
    if (rec.status === 'Present') summary.present++;
    else if (rec.status === 'Late') { summary.late++; summary.present++; }
    else if (rec.status === 'Half Day') summary.halfDay++;
    else if (rec.status === 'Leave') summary.leaves++;
    else if (rec.status === 'Absent') summary.absent++;
    // Today's total_hours is only (re)written on clock-out, so while still
    // clocked in it excludes today's in-progress session — skip it here and
    // add the live-ticking total below instead (mirrors the Home screen).
    const isToday = attYear === today.getFullYear() && attMonth === today.getMonth() && d === today.getDate();
    if (!isToday) summary.totalHours += rec.total_hours || 0;
  }
  if (attYear === today.getFullYear() && attMonth === today.getMonth()) {
    summary.totalHours += clock.timerSeconds / 3600;
  }

  const statusText = clock.isClockedIn ? 'Currently Working' : clock.myPunches?.punches?.length ? 'Clocked Out' : 'Not Clocked In';

  // The clock hook tracks today's punches live (including the one just made,
  // before a refetch would pick it up); any other date reads straight from the
  // month's already-fetched records (fetchMyMonthAttendance selects punches(*)
  // alongside each attendance row, so no extra request is needed here).
  const isSelectedToday = selectedDate === todayStr();
  const selectedPunches = isSelectedToday
    ? clock.myPunches?.punches || []
    : myRecords.find((r) => r.date === selectedDate)?.punches || [];

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}>

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
              <Text style={s.liveTime}>{clock.liveClock}</Text>
              <Text style={s.liveDate}>{clock.liveDate}</Text>
              <View style={s.statusRow}>
                <StatusPulse active={clock.isClockedIn} />
                <Text style={s.statusText}>{statusText}</Text>
              </View>
              <View style={s.locationRow}>
                <Ionicons name="location-outline" size={11} color="rgba(255,255,255,0.4)" />
                <Text style={s.locationText} numberOfLines={1}>{clock.locationStatus}</Text>
              </View>
            </View>
            <View style={s.timerBox}>
              <Text style={s.timerLabel}>TODAY'S HOURS</Text>
              <Text style={s.timerValue}>{clock.timerDisplay}</Text>
              {clock.isClockedIn && (
                <View style={s.timerActivePill}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.success }} />
                  <Text style={s.timerActiveTxt}>Live</Text>
                </View>
              )}
            </View>
          </View>

          {/* Divider */}
          <View style={s.widgetDivider} />

          {/* Clock button — single full-width control that swaps state, rather
              than showing both actions side by side with one disabled. */}
          <Animated.View style={{ transform: [{ scale: btnScale }] }}>
            <TouchableOpacity
              style={[s.clockActionBtn, clock.isClockedIn ? s.clockOutBtn : s.clockInBtn, clock.actionLoading && s.btnDisabled]}
              onPress={clock.isClockedIn ? handleClockOut : handleClockIn}
              disabled={clock.actionLoading}
              activeOpacity={0.85}
            >
              {clock.actionLoading
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <Ionicons
                      name={clock.isClockedIn ? 'log-out-outline' : 'log-in-outline'}
                      size={20}
                      color="#fff"
                    />
                    <Text style={s.clockBtnText}>{clock.isClockedIn ? 'Clock Out' : 'Clock In'}</Text>
                  </>}
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* ── Summary strip ── */}
        <View style={s.summaryStrip}>
          {[
            { val: summary.present, lbl: 'Present', color: C.success },
            { val: summary.absent, lbl: 'Absent', color: C.danger },
            { val: summary.halfDay, lbl: 'Half Day', color: '#F97316' },
            { val: summary.late, lbl: 'Late', color: C.warning },
            { val: summary.leaves, lbl: 'Leaves', color: C.purple },
            { val: fmtHMS(summary.totalHours * 3600), lbl: 'Hrs', color: C.primary },
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

        {/* ── Selected day's punch timeline ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <View style={s.cardTitleRow}>
              <View style={[s.cardTitleDot, { backgroundColor: C.success }]} />
              <Text style={s.cardTitle}>{isSelectedToday ? "Today's Timeline" : fmtDate(selectedDate)}</Text>
            </View>
          </View>
          {!selectedPunches.length ? (
            <View style={s.emptyRow}>
              <Ionicons name="time-outline" size={28} color={C.muted} />
              <Text style={s.emptyText}>
                {isSelectedToday ? 'No punches recorded today.' : 'No punches recorded on this date.'}
              </Text>
            </View>
          ) : (
            <View style={s.timeline}>
              {[...selectedPunches]
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

  clockActionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 14, paddingVertical: 15, gap: 8,
    shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  clockInBtn: { backgroundColor: C.success, shadowColor: C.success },
  clockOutBtn: { backgroundColor: C.danger, shadowColor: C.danger },
  clockBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  btnDisabled: { opacity: 0.6 },

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
  calCellSelected: { borderWidth: 1.5, borderColor: C.primary },
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
