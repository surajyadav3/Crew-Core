import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Animated, Easing, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { useFeatures } from '@/context/FeatureContext';
import { useClockInOut } from '@/hooks/useClockInOut';
import { fetchMyMonthAttendance, listMyRegularizeRequests } from '@/services/attendanceService';
import { listHolidays } from '@/services/holidayService';
import { getOutlet } from '@/services/tenantService';
import { showToast } from '@/components/Toast';
import RegularizeRequestModal from '@/components/RegularizeRequestModal';
import RegularizeExtensionNotice from '@/components/RegularizeExtensionNotice';
import { todayStr, dateStr, fmtTime12, fmtHMS, fmtDate, monthLabel, isTenantWeeklyOff, getEarlyLateBreakdown, regularizeMinDate, regularizeWindowLabel } from '@/lib/helpers';
import { supabase } from '@/lib/supabase';

import { Colors as C } from '@/constants/Colors';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS_COLORS: Record<string, string> = {
  Present: C.success,
  Late: C.warning,
  'Half Day': '#F97316',
  Absent: C.danger,
  Leave: C.purple,
  Mispunch: '#DB2777',
  // App punches at outlets that need manager approval (Raniwala Office /
  // Factory / Delhi) hold the day here until the manager decides.
  'Pending Approval': C.amber,
};

// A punch's approval state (punches.approval_status). Device and auto-approved
// punches are 'approved' and show no pill.
const PUNCH_APPROVAL: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'Awaiting manager approval', color: C.amber, bg: C.amberBg },
  rejected: { label: 'Rejected', color: C.danger, bg: C.dangerBg },
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
  const [myOutlet, setMyOutlet] = useState<any>(null);
  const [myShift, setMyShift] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myRegRequests, setMyRegRequests] = useState<any[]>([]);
  const [showRegModal, setShowRegModal] = useState(false);
  const { isEnabled } = useFeatures();

  const btnScale = useRef(new Animated.Value(1)).current;

  const fetchData = useCallback(async () => {
    if (!profile || !tenant) return;
    const [{ data, error }, regRes] = await Promise.all([
      fetchMyMonthAttendance(profile.id, attYear, attMonth),
      listMyRegularizeRequests(profile.id),
    ]);
    if (!regRes.error) setMyRegRequests(regRes.data);
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
    // Company-wide holidays plus this employee's outlet-only ones.
    listHolidays(tenant.id, profile?.outlet_id).then(({ data, error }) => {
      if (error) { showToast('Could not load holidays.', 'error'); return; }
      setHolidays(data);
    });
  }, [tenant, profile?.outlet_id]);

  // Assigned shift (if any) — its start/end are what Late Arrival / Early Left
  // are measured against, same precedence as clockOut: shift > outlet > tenant.
  useEffect(() => {
    if (!profile?.shift_id) { setMyShift(null); return; }
    supabase.from('shifts').select('start_time, end_time').eq('id', profile.shift_id).maybeSingle()
      .then(({ data }) => setMyShift(data));
  }, [profile?.shift_id]);

  // Needed so the calendar's weekend shading follows this employee's actual
  // outlet — e.g. Raniwala's Delhi outlet is off Monday, not Sat/Sun.
  useEffect(() => {
    if (!profile?.outlet_id) { setMyOutlet(null); return; }
    getOutlet(profile.outlet_id).then(({ data }) => setMyOutlet(data));
  }, [profile?.outlet_id]);

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
      const isWeekend = isTenantWeeklyOff(date, tenant, myOutlet);
      const holiday = holidays.find((h) => h.date === ds && h.status === 'Approved');
      const rec = myRecords.find((r) => r.date === ds);

      let bg = 'transparent';
      let textColor = C.text;

      if (isToday) bg = C.primary;
      else if (holiday) { bg = C.teal + '22'; textColor = C.teal; }
      else if (isFuture) { textColor = '#CBD5E1'; if (isWeekend) bg = C.border + '66'; }
      // Worked on an off day still shows its real status.
      else if (isWeekend && !rec) { bg = C.border + '66'; textColor = C.muted; }
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
          {isWeekend && !rec && !holiday && !isToday && <Text style={s.calOff}>Off</Text>}
          {rec && !isToday && !holiday && (
            <View style={[s.calDot, { backgroundColor: STATUS_COLORS[rec?.status] || C.primary }]} />
          )}
          {(rec?.early_late_flag || rec?.early_late_graced) && (
            <View style={[s.elDot, { backgroundColor: rec.early_late_flag ? C.danger : C.muted }]} />
          )}
        </TouchableOpacity>
      );
    }
    return cells;
  };

  const summary = { present: 0, absent: 0, halfDay: 0, late: 0, mispunch: 0, leaves: 0, totalHours: 0, earlyLate: 0 };
  const today = new Date();
  for (let d = 1; d <= new Date(attYear, attMonth + 1, 0).getDate(); d++) {
    const date = new Date(attYear, attMonth, d);
    if (date > today || isTenantWeeklyOff(date, tenant, myOutlet)) continue;
    const ds = dateStr(date);
    if (holidays.find((h) => h.date === ds && h.status === 'Approved')) continue;
    const rec = myRecords.find((r) => r.date === ds);
    if (!rec?.status) { if (date < today) summary.absent++; continue; }
    if (rec.status === 'Present') summary.present++;
    else if (rec.status === 'Late') { summary.late++; summary.present++; }
    else if (rec.status === 'Half Day') summary.halfDay++;
    else if (rec.status === 'Leave') summary.leaves++;
    else if (rec.status === 'Absent') summary.absent++;
    else if (rec.status === 'Mispunch') summary.mispunch++;
    if (rec.early_late_flag) summary.earlyLate++;
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

  // What the selected day was: holiday / weekly off / its attendance status,
  // plus Late Arrival / Early Left (90-min rule) against the effective shift.
  const selectedRec = myRecords.find((r) => r.date === selectedDate);
  const selectedHoliday = holidays.find((h) => h.date === selectedDate && h.status === 'Approved');
  const selectedIsOff = isTenantWeeklyOff(new Date(selectedDate + 'T00:00:00'), tenant, myOutlet);
  const shiftStart = myShift?.start_time || myOutlet?.shift_start || tenant?.shift_start || '10:30';
  const shiftEnd = myShift?.end_time || myOutlet?.shift_end || tenant?.shift_end || '18:00';
  const sortedPunches = [...selectedPunches].sort((a: any, b: any) => a.punch_time.localeCompare(b.punch_time));
  const firstPunch = sortedPunches[0]?.punch_time;
  const lastPunch = sortedPunches[sortedPunches.length - 1]?.punch_time;
  const breakdown = getEarlyLateBreakdown(firstPunch, lastPunch, shiftStart, shiftEnd);
  // A mispunch day is flagged as such, not as Late Arrival.
  const lateArrival = !!firstPunch && breakdown.lateArrival && selectedRec?.status !== 'Mispunch';
  // Still clocked in → the day isn't over, so it can't be "early left" yet.
  const earlyLeft = sortedPunches[sortedPunches.length - 1]?.punch_type === 'out' && breakdown.earlyLeft;
  const dayChips: { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }[] = [];
  if (selectedHoliday) dayChips.push({ label: `Holiday · ${selectedHoliday.name}`, color: C.teal, bg: C.tealBg, icon: 'gift-outline' });
  if (selectedIsOff) dayChips.push({ label: 'Weekly Off', color: C.muted, bg: C.border, icon: 'bed-outline' });
  if (selectedRec?.status) {
    const color = STATUS_COLORS[selectedRec.status] || C.primary;
    dayChips.push({
      label: selectedRec.status, color, bg: color + '22',
      icon: selectedRec.status === 'Late' ? 'alarm-outline'
        : selectedRec.status === 'Mispunch' ? 'finger-print'
        : selectedRec.status === 'Pending Approval' ? 'hourglass-outline'
        : 'checkmark-circle-outline',
    });
  }
  if (lateArrival) dayChips.push({ label: `Late Arrival · in at ${fmtTime12(firstPunch)} (shift ${fmtTime12(shiftStart)})`, color: C.danger, bg: C.dangerBg, icon: 'log-in-outline' });
  if (earlyLeft) dayChips.push({ label: `Early Left · out at ${fmtTime12(lastPunch)} (shift ends ${fmtTime12(shiftEnd)})`, color: C.danger, bg: C.dangerBg, icon: 'log-out-outline' });
  // Regularize straight from the calendar: a Late / Mispunch / Half Day /
  // Absent day (or a working day with no record at all) that's still inside
  // the tenant's regularize window (default today + yesterday — the DB
  // enforces the same window, see enforce_regularize_request_window).
  const selectedNeedsFix = selectedRec
    ? ['Late', 'Mispunch', 'Half Day', 'Absent'].includes(selectedRec.status) || lateArrival || earlyLeft
    : !selectedHoliday && !selectedIsOff && selectedDate < todayStr();
  const selectedRegRequest = myRegRequests.find((r) => r.date === selectedDate && r.status !== 'Rejected');
  const selectedInRegWindow = selectedDate <= todayStr() && selectedDate >= regularizeMinDate(tenant);
  const regEnabled = isEnabled('regularize_attendance');
  // Any working day inside the window can be regularized (e.g. a wrong punch
  // on an otherwise Present day), not just the flagged ones.
  const showRegularize = regEnabled
    && (selectedNeedsFix || (selectedInRegWindow && !selectedHoliday && !selectedIsOff));
  // Header shortcut: regularizes whichever calendar day is selected.
  const openRegularize = () => {
    if (selectedRegRequest) {
      showToast(`Regularization for ${fmtDate(selectedDate)} is already ${selectedRegRequest.status === 'Approved' ? 'approved' : 'pending approval'}.`, 'info');
    } else if (!selectedInRegWindow) {
      showToast(`Select a date on the calendar — regularization is allowed for ${regularizeWindowLabel(tenant)} only.`, 'info');
    } else {
      setShowRegModal(true);
    }
  };
  const regDefaultIn = sortedPunches[0]?.punch_type === 'in' && !lateArrival ? firstPunch : shiftStart;
  const regDefaultOut = sortedPunches[sortedPunches.length - 1]?.punch_type === 'out' && !earlyLeft ? lastPunch : shiftEnd;

  const earlyLateNote = selectedRec?.early_late_flag
    ? "Counted towards this month's Early Left / Late Arrival."
    : selectedRec?.early_late_graced
      ? 'First Early Left / Late Arrival this month — graced, not counted.'
      : null;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}>

        {/* ── Page header ── */}
        <View style={s.pageHeader}>
          <View>
            <Text style={s.pageTitle}>Attendance</Text>
            <Text style={s.pageSubtitle}>{monthLabel(attMonth, attYear)}</Text>
          </View>
          {regEnabled && (
            <TouchableOpacity style={s.headerRegBtn} onPress={openRegularize} activeOpacity={0.85}>
              <Ionicons name="create-outline" size={16} color="#fff" />
              <Text style={s.headerRegBtnText}>Regularize</Text>
            </TouchableOpacity>
          )}
        </View>

        {regEnabled && <RegularizeExtensionNotice tenant={tenant} style={{ marginBottom: 12 }} />}

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
            { val: summary.mispunch, lbl: 'Mispunch', color: '#DB2777' },
            { val: summary.earlyLate, lbl: 'Early/Late', color: C.danger },
            { val: summary.leaves, lbl: 'Leaves', color: C.purple },
            { val: fmtHMS(summary.totalHours * 3600), lbl: 'Hrs', color: C.primary },
          ].map((item, idx) => (
            <View key={item.lbl} style={[s.summaryItem, idx % 4 !== 3 && s.summaryItemBorder]}>
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
          {/* Regularize the day selected on the calendar — goes to the
              employee's reporting manager for approval, with HR notified. */}
          {regEnabled && (
            <View style={s.calRegWrap}>
              <TouchableOpacity style={s.regBtn} onPress={openRegularize} activeOpacity={0.85}>
                <Ionicons name="create-outline" size={16} color={C.primary} />
                <Text style={s.regBtnText}>Regularize {fmtDate(selectedDate)}</Text>
              </TouchableOpacity>
              <Text style={s.calRegNote}>Tap a date above, then send a correction to your manager & HR for approval.</Text>
            </View>
          )}
          {/* Legend */}
          <View style={s.legend}>
            {Object.entries(STATUS_COLORS).map(([key, color]) => (
              <View key={key} style={s.legendItem}>
                <View style={[s.legendDot, { backgroundColor: color }]} />
                <Text style={s.legendText}>{key}</Text>
              </View>
            ))}
            <View style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: C.teal }]} />
              <Text style={s.legendText}>Holiday</Text>
            </View>
            <View style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: C.border }]} />
              <Text style={s.legendText}>Weekly Off</Text>
            </View>
            <View style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: C.danger, width: 6, height: 6 }]} />
              <Text style={s.legendText}>Early Left / Late Arrival</Text>
            </View>
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
          {(dayChips.length > 0 || !!earlyLateNote) && (
            <View style={s.dayChips}>
              {dayChips.map((c) => (
                <View key={c.label} style={[s.dayChip, { backgroundColor: c.bg }]}>
                  <Ionicons name={c.icon} size={13} color={c.color} />
                  <Text style={[s.dayChipText, { color: c.color }]}>{c.label}</Text>
                </View>
              ))}
              {!!earlyLateNote && <Text style={s.dayNote}>{earlyLateNote}</Text>}
            </View>
          )}
          {showRegularize && (
            selectedRegRequest ? (
              <View style={s.regStatus}>
                <Ionicons name={selectedRegRequest.status === 'Approved' ? 'checkmark-circle' : 'hourglass-outline'} size={15}
                  color={selectedRegRequest.status === 'Approved' ? C.success : C.warning} />
                <Text style={s.regStatusText}>Regularization {selectedRegRequest.status === 'Approved' ? 'approved' : 'pending approval'}</Text>
              </View>
            ) : selectedInRegWindow ? (
              <TouchableOpacity style={s.regBtn} onPress={() => setShowRegModal(true)} activeOpacity={0.85}>
                <Ionicons name="create-outline" size={16} color={C.primary} />
                <Text style={s.regBtnText}>Request Regularization</Text>
              </TouchableOpacity>
            ) : (
              <Text style={s.regNote}>Regularization can only be requested for {regularizeWindowLabel(tenant)}.</Text>
            )
          )}
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
                      {!!PUNCH_APPROVAL[p.approval_status] && (
                        <View style={[s.tlTypePill, { backgroundColor: PUNCH_APPROVAL[p.approval_status].bg }]}>
                          <Text style={[s.tlType, { color: PUNCH_APPROVAL[p.approval_status].color }]}>
                            {PUNCH_APPROVAL[p.approval_status].label}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                ))}
            </View>
          )}
        </View>
      </ScrollView>
      <RegularizeRequestModal
        visible={showRegModal}
        date={selectedDate}
        defaultIn={regDefaultIn}
        defaultOut={regDefaultOut}
        onClose={() => setShowRegModal(false)}
        onSubmitted={fetchData}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.dark },
  scroll: { flex: 1, backgroundColor: C.bg },
  pageHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14,
    backgroundColor: C.dark,
  },
  headerRegBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14,
  },
  headerRegBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
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
    flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, backgroundColor: C.surface,
    marginHorizontal: 14, borderRadius: 18,
    paddingVertical: 14, paddingHorizontal: 6, marginBottom: 14,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  summaryItem: { width: '25%', alignItems: 'center' },
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
  calCell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 1, position: 'relative' },
  calCellSelected: { borderWidth: 1.5, borderColor: C.primary },
  calDay: { fontSize: 12, color: C.text },
  calDot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
  calOff: { fontSize: 7.5, color: C.muted, fontWeight: '700', marginTop: 1, textTransform: 'uppercase' },
  dayChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  dayChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5, maxWidth: '100%' },
  dayChipText: { fontSize: 11.5, fontWeight: '700', flexShrink: 1 },
  dayNote: { width: '100%', fontSize: 11.5, color: C.muted, marginTop: 2 },
  regBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: C.primary, backgroundColor: C.primaryBg,
    borderRadius: 12, paddingVertical: 10, marginBottom: 12,
  },
  regBtnText: { fontSize: 13, fontWeight: '700', color: C.primary },
  calRegWrap: { marginTop: 12 },
  calRegNote: { fontSize: 11.5, color: C.muted, textAlign: 'center', marginTop: -4, marginBottom: 8 },
  regStatus: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.bg, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12, marginBottom: 12,
  },
  regStatusText: { fontSize: 12.5, fontWeight: '600', color: C.text },
  regNote: { fontSize: 11.5, color: C.muted, marginBottom: 12 },
  elDot: { position: 'absolute', top: 3, right: 5, width: 6, height: 6, borderRadius: 3 },
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
  timelineRight: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingBottom: 16 },
  tlTime: { fontSize: 14, fontWeight: '700', color: C.text, width: 84, fontVariant: ['tabular-nums'] },
  tlTypePill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  tlType: { fontSize: 12, fontWeight: '700' },
});
