import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useForegroundRefresh } from '@/hooks/useForegroundRefresh';
import { showToast } from '@/components/Toast';
import PageHeader from '@/components/PageHeader';
import { supabase } from '@/lib/supabase';
import { requestHalfDayLabel } from '@/lib/halfDayLeave';
import { fetchMemberMonth, makeDayKind, firstInLastOut, DAY_KIND_STYLE, type DayKind } from '@/services/teamService';
import { dateStr, fmtDate, fmtTime12, monthLabel, personName } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Month stat tiles, in order — late and half days are worked days too.
const STAT_KINDS: DayKind[] = ['present', 'late', 'half', 'absent', 'mispunch', 'leave', 'wfh', 'off', 'holiday'];

// Day kinds drawn as a plain date number; every other kind gets a colour.
const PLAIN = new Set<DayKind>(['present', 'none']);

export default function TeamMemberScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { tenant } = useAuth();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [member, setMember] = useState<any>(null);
  const [month, setMonth] = useState<Awaited<ReturnType<typeof fetchMemberMonth>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [picked, setPicked] = useState<string | null>(dateStr(now));

  const fetchData = useCallback(async () => {
    if (!tenant || !id) return;
    const { data: m, error } = await supabase
      .from('profile_directory')
      .select('id, first_name, middle_name, last_name, employee_id, role, department, designation, manager_id, outlet_id, outlet_location')
      .eq('id', id)
      .maybeSingle();
    if (error || !m) { showToast('Could not load this employee.', 'error'); return; }
    setMember(m);
    const res = await fetchMemberMonth(tenant.id, m, ym.y, ym.m);
    if (res.error) showToast('Some attendance data failed to load.', 'error');
    setMonth(res);
  }, [tenant, id, ym.y, ym.m]);

  useForegroundRefresh(fetchData, setLoading);

  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const today = dateStr(new Date());
  const days = useMemo(() => {
    const out: Date[] = [];
    for (let d = new Date(ym.y, ym.m, 1); d.getMonth() === ym.m; d.setDate(d.getDate() + 1)) out.push(new Date(d));
    return out;
  }, [ym.y, ym.m]);

  const dayKind = useMemo(() => {
    if (!month || !member) return null;
    return makeDayKind({
      tenant, today,
      attendance: month.attendance, leaves: month.leaves, wfh: month.wfh,
      holidays: month.holidays, outlets: month.outlets,
      joinDates: new Map([[member.id, month.details?.join_date || null]]),
    });
  }, [month, member, tenant, today]);

  const cells = useMemo(() => (dayKind && member ? days.map((d) => ({ d, ds: dateStr(d), ...dayKind(member, d) })) : []), [dayKind, member, days]);

  const stats = useMemo(() => {
    const c: Partial<Record<DayKind, number>> = {};
    cells.forEach((cell) => { if (cell.ds <= today) c[cell.kind] = (c[cell.kind] || 0) + 1; });
    return c;
  }, [cells, today]);

  const pickedCell = cells.find((c) => c.ds === picked);
  const pickedTimes = firstInLastOut(pickedCell?.att);

  const shiftMonth = (delta: number) => {
    setPicked(null);
    setYm(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  const phone = month?.details?.phone ? String(month.details.phone).replace(/\D/g, '').slice(-10) : '';
  const leadBlanks = days.length ? days[0].getDay() : 0;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageHeader
        title={member ? personName(member) : 'Team Member'}
        subtitle={member ? [member.employee_id ? `EMP ${member.employee_id}` : null, member.designation, member.department].filter(Boolean).join(' · ') : ''}
        onBack={() => router.back()}
      />

      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
      >
        {loading && !month ? (
          <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>
        ) : !member ? null : (
          <>
            {/* ── Contact ───────────────────────────────────────────────── */}
            <View style={s.card}>
              <View style={s.infoGrid}>
                <Info label="Location" value={member.outlet_location || '—'} />
                <Info label="Joined" value={month?.details?.join_date ? fmtDate(month.details.join_date) : '—'} />
                <Info label="Phone" value={phone || '—'} />
              </View>
              {!!phone && (
                <View style={s.contactRow}>
                  <TouchableOpacity style={[s.contactBtn, { backgroundColor: C.successBg }]} onPress={() => Linking.openURL(`tel:${phone}`)} activeOpacity={0.85}>
                    <Ionicons name="call" size={15} color={C.success} />
                    <Text style={[s.contactText, { color: C.success }]}>Call</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.contactBtn, { backgroundColor: '#DCFCE7' }]} onPress={() => Linking.openURL(`https://wa.me/91${phone}`)} activeOpacity={0.85}>
                    <Ionicons name="logo-whatsapp" size={15} color="#16A34A" />
                    <Text style={[s.contactText, { color: '#16A34A' }]}>WhatsApp</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* ── Month calendar ────────────────────────────────────────── */}
            <View style={s.card}>
              <View style={s.monthNav}>
                <TouchableOpacity onPress={() => shiftMonth(-1)} style={s.navBtn} hitSlop={8}><Ionicons name="chevron-back" size={18} color={C.text} /></TouchableOpacity>
                <Text style={s.monthText}>{monthLabel(ym.m, ym.y)}</Text>
                <TouchableOpacity onPress={() => shiftMonth(1)} style={s.navBtn} hitSlop={8}><Ionicons name="chevron-forward" size={18} color={C.text} /></TouchableOpacity>
              </View>
              <View style={s.weekRow}>
                {WEEKDAYS.map((w, i) => <Text key={i} style={s.weekday}>{w}</Text>)}
              </View>
              <View style={s.calGrid}>
                {Array.from({ length: leadBlanks }).map((_, i) => <View key={`b${i}`} style={s.cell} />)}
                {cells.map((cell) => {
                  const st = DAY_KIND_STYLE[cell.kind];
                  const plain = PLAIN.has(cell.kind);
                  const isToday = cell.ds === today;
                  const isPicked = cell.ds === picked;
                  return (
                    <TouchableOpacity key={cell.ds} style={s.cell} onPress={() => setPicked(cell.ds)} activeOpacity={0.7}>
                      <View style={[
                        s.cellInner,
                        !plain && { backgroundColor: st.bg },
                        isToday && { borderWidth: 1.5, borderColor: C.primary },
                        isPicked && { borderWidth: 2, borderColor: C.dark },
                      ]}>
                        <Text style={[s.cellText, !plain && { color: st.color, fontWeight: '800' }]}>{cell.d.getDate()}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {pickedCell && (
                <View style={s.pickedBox}>
                  <Text style={s.pickedDate}>{fmtDate(pickedCell.ds)}</Text>
                  <View style={[s.pill, { backgroundColor: DAY_KIND_STYLE[pickedCell.kind].bg }]}>
                    <Text style={[s.pillText, { color: DAY_KIND_STYLE[pickedCell.kind].color }]}>{pickedCell.title || DAY_KIND_STYLE[pickedCell.kind].label}</Text>
                  </View>
                  {(pickedTimes.inAt || pickedTimes.outAt) && (
                    <Text style={s.pickedTimes}>
                      In {pickedTimes.inAt ? fmtTime12(pickedTimes.inAt) : '—'} · Out {pickedTimes.outAt ? fmtTime12(pickedTimes.outAt) : '—'}
                      {pickedCell.att?.total_hours ? ` · ${Number(pickedCell.att.total_hours).toFixed(1)}h` : ''}
                    </Text>
                  )}
                </View>
              )}
            </View>

            {/* ── Month stats ───────────────────────────────────────────── */}
            <Text style={s.sectionLabel}>This month so far</Text>
            <View style={s.statGrid}>
              {STAT_KINDS.map((k) => (
                <View key={k} style={s.statTile}>
                  <Text style={[s.statVal, { color: DAY_KIND_STYLE[k].color }]}>{stats[k] || 0}</Text>
                  <Text style={s.statLbl}>{DAY_KIND_STYLE[k].label}</Text>
                </View>
              ))}
            </View>

            {/* ── Leave this month ──────────────────────────────────────── */}
            {(month?.leaves || []).length > 0 && (
              <>
                <Text style={s.sectionLabel}>Leave this month</Text>
                <View style={s.card}>
                  {month!.leaves.map((l) => {
                    const half = requestHalfDayLabel(l);
                    return (
                      <View key={l.id} style={s.leaveRow}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.leaveType}>{l.leave_type}</Text>
                          <Text style={s.leaveMeta}>
                            {fmtDate(l.start_date)}{l.end_date !== l.start_date ? ` – ${fmtDate(l.end_date)}` : ''}{half ? ` · ${half}` : ''}
                          </Text>
                          {!!l.reason && <Text style={s.leaveMeta} numberOfLines={2}>{l.reason}</Text>}
                        </View>
                        <Text style={[s.leaveStatus, { color: l.status === 'Approved' ? C.success : C.amber }]}>{l.status}</Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.surface },
  scroll: { flex: 1, backgroundColor: C.bg },
  loadingBox: { padding: 60, alignItems: 'center' },
  card: { marginHorizontal: 14, marginTop: 12, backgroundColor: C.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border },
  infoGrid: { flexDirection: 'row', gap: 10 },
  infoLabel: { fontSize: 10.5, fontWeight: '800', color: C.muted, textTransform: 'uppercase' },
  infoValue: { fontSize: 13, fontWeight: '700', color: C.text, marginTop: 2 },
  contactRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  contactBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 10 },
  contactText: { fontSize: 13, fontWeight: '800' },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  navBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  monthText: { fontSize: 15, fontWeight: '800', color: C.text },
  weekRow: { flexDirection: 'row' },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 11, fontWeight: '800', color: C.muted, paddingVertical: 4 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2.5 },
  cellInner: { flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cellText: { fontSize: 13, color: C.text, fontWeight: '600' },
  pickedBox: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 10, backgroundColor: C.bg, borderRadius: 12, padding: 10 },
  pickedDate: { fontSize: 13, fontWeight: '800', color: C.text },
  pickedTimes: { width: '100%', fontSize: 12, color: C.muted, fontWeight: '600' },
  pill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: '800' },
  sectionLabel: { fontSize: 11.5, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: 20, marginTop: 18, marginBottom: -2 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10, marginTop: 8 },
  statTile: { width: '33.33%', padding: 4 },
  statVal: { fontSize: 20, fontWeight: '800', backgroundColor: C.surface, borderTopLeftRadius: 14, borderTopRightRadius: 14, textAlign: 'center', paddingTop: 10 },
  statLbl: { fontSize: 11, fontWeight: '700', color: C.muted, backgroundColor: C.surface, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, textAlign: 'center', paddingBottom: 10 },
  leaveRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  leaveType: { fontSize: 13, fontWeight: '800', color: C.text },
  leaveMeta: { fontSize: 11.5, color: C.muted, marginTop: 1 },
  leaveStatus: { fontSize: 12, fontWeight: '800' },
});
