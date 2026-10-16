import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, SectionList, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useApprovals } from '@/context/ApprovalsContext';
import { useForegroundRefresh } from '@/hooks/useForegroundRefresh';
import { showToast } from '@/components/Toast';
import PageHeader from '@/components/PageHeader';
import { kindInfo, isHrRole } from '@/lib/approvals';
import { requestHalfDayLabel } from '@/lib/halfDayLeave';
import {
  fetchMyTeam, fetchTeamToday, fetchTeamUpcomingLeaves, makeDayKind, firstInLastOut,
  DAY_KIND_STYLE, type DayKind,
} from '@/services/teamService';
import { fmtDate, fmtTime12, personName, isRaniwalaTenant } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

type Bucket = 'all' | 'in' | 'notin' | 'leave' | 'wfh' | 'off';

const BUCKETS: { key: Bucket; label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'in', label: 'In', color: C.success, bg: C.successBg, icon: 'checkmark-circle' },
  { key: 'notin', label: 'Not In', color: C.danger, bg: C.dangerBg, icon: 'alert-circle' },
  { key: 'leave', label: 'On Leave', color: C.primary, bg: C.primaryBg, icon: 'airplane' },
  { key: 'wfh', label: 'WFH', color: C.rose, bg: C.roseBg, icon: 'home' },
  { key: 'off', label: 'Off', color: C.muted, bg: '#F1F5F9', icon: 'moon' },
];

const BUCKET_OF: Record<DayKind, Bucket> = {
  present: 'in', late: 'in', half: 'in', mispunch: 'in', 'pending-approval': 'in',
  absent: 'notin', none: 'notin',
  leave: 'leave', 'leave-pending': 'leave',
  wfh: 'wfh',
  off: 'off', holiday: 'off',
};

const ROLE_LABEL: Record<string, string> = { manager: 'Manager', hod: 'Head of Department', management: 'Management', admin: 'HR' };

const initials = (p: any) => [p?.first_name?.[0], p?.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?';

export default function TeamScreen() {
  const router = useRouter();
  const { profile, tenant } = useAuth();
  const { kinds, counts, total, refresh: refreshCounts } = useApprovals();
  const raniwala = isRaniwalaTenant(tenant);
  const hr = isHrRole(profile?.role);

  const [team, setTeam] = useState<any[]>([]);
  const [directory, setDirectory] = useState<any[]>([]);
  const [today, setToday] = useState<Awaited<ReturnType<typeof fetchTeamToday>> | null>(null);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [bucket, setBucket] = useState<Bucket>('all');

  const fetchData = useCallback(async () => {
    if (!profile || !tenant) return;
    const [teamRes, todayRes, upRes] = await Promise.all([
      fetchMyTeam(tenant.id, profile),
      fetchTeamToday(tenant.id),
      fetchTeamUpcomingLeaves(tenant.id),
      refreshCounts(),
    ]);
    if (teamRes.error || todayRes.error) showToast('Some team data failed to load.', 'error');
    setTeam(teamRes.team);
    setDirectory(teamRes.directory);
    setToday(todayRes);
    setUpcoming(upRes.data);
  }, [profile, tenant, refreshCounts]);

  useForegroundRefresh(fetchData, setLoading);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchData(), refreshCounts(true)]);
    setRefreshing(false);
  };

  const teamIds = useMemo(() => new Set(team.map((m) => m.id)), [team]);
  const byId = useMemo(() => new Map(directory.map((p) => [p.id, p])), [directory]);

  // Today's status for each member — the website My Team calendar's rules.
  const statusById = useMemo(() => {
    const out = new Map<string, ReturnType<ReturnType<typeof makeDayKind>>>();
    if (!today) return out;
    const dayKind = makeDayKind({
      tenant, today: today.today,
      attendance: today.attendance.filter((a) => teamIds.has(a.profile_id)),
      leaves: today.leaves.filter((l) => teamIds.has(l.profile_id)),
      wfh: today.wfh.filter((w) => teamIds.has(w.profile_id)),
      holidays: today.holidays, outlets: today.outlets,
    });
    const now = new Date();
    team.forEach((m) => out.set(m.id, dayKind(m, now)));
    return out;
  }, [today, team, teamIds, tenant]);

  const bucketCounts = useMemo(() => {
    const c: Record<Bucket, number> = { all: team.length, in: 0, notin: 0, leave: 0, wfh: 0, off: 0 };
    statusById.forEach((st) => { c[BUCKET_OF[st.kind]]++; });
    return c;
  }, [statusById, team.length]);

  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups = new Map<string, any[]>();
    team.forEach((m) => {
      const st = statusById.get(m.id);
      if (bucket !== 'all' && (!st || BUCKET_OF[st.kind] !== bucket)) return;
      if (q && !`${m.first_name || ''} ${m.middle_name || ''} ${m.last_name || ''} ${m.employee_id || ''} ${m.designation || ''}`.toLowerCase().includes(q)) return;
      const dept = m.department || 'Other';
      if (!groups.has(dept)) groups.set(dept, []);
      groups.get(dept)!.push(m);
    });
    return [...groups.entries()]
      .sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)))
      .map(([title, data]) => ({ title, data: data.sort((a, b) => personName(a).localeCompare(personName(b))) }));
  }, [team, statusById, search, bucket]);

  const teamUpcoming = useMemo(() => upcoming.filter((l) => teamIds.has(l.profile_id)).slice(0, 8), [upcoming, teamIds]);

  const myManager = byId.get(profile?.manager_id);
  const myHod = byId.get(profile?.hod_id);
  const subtitle = hr
    ? 'Everyone in the company'
    : profile?.role === 'hod' || profile?.role === 'management'
      ? 'Your department — managers under you and their teams'
      : [myHod ? `HOD: ${personName(myHod)}` : null, myManager && myManager.id !== myHod?.id ? `Reports to: ${personName(myManager)}` : null]
        .filter(Boolean).join('  ·  ') || 'People who report to you';

  const reportsTo = (m: any) => (m.manager_id === profile?.id ? 'You' : byId.get(m.manager_id) ? personName(byId.get(m.manager_id)) : '');

  const header = (
    <View>
      {/* ── Approvals inbox ─────────────────────────────────────────────── */}
      {kinds.length > 0 && (
        <View style={s.inboxCard}>
          <TouchableOpacity style={s.inboxTop} onPress={() => router.push('/approvals' as any)} activeOpacity={0.85}>
            <View style={s.inboxIcon}><Ionicons name="file-tray-full" size={22} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.inboxTitle}>{total > 0 ? `${total} request${total !== 1 ? 's' : ''} need${total === 1 ? 's' : ''} you` : 'All caught up'}</Text>
              <Text style={s.inboxSub}>{total > 0 ? 'Approve or reject right here — no laptop needed' : 'Nothing is waiting on your approval'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.muted} />
          </TouchableOpacity>
          <View style={s.kindGrid}>
            {kinds.map((k) => {
              const ki = kindInfo(k);
              const n = counts[k] || 0;
              return (
                <TouchableOpacity
                  key={k}
                  style={s.kindTile}
                  onPress={() => router.push((k === 'verification' ? '/team-verification' : `/approvals?kind=${k}`) as any)}
                  activeOpacity={0.85}
                >
                  <View style={[s.kindIcon, { backgroundColor: ki.bg }]}>
                    <Ionicons name={ki.icon} size={18} color={ki.color} />
                    {n > 0 && <View style={s.kindBadge}><Text style={s.kindBadgeText}>{n > 99 ? '99+' : n}</Text></View>}
                  </View>
                  <Text style={s.kindLabel} numberOfLines={1}>{ki.short}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* ── Today ───────────────────────────────────────────────────────── */}
      <View style={s.sectionHead}>
        <Text style={s.sectionLabel}>Today · {team.length} {team.length === 1 ? 'person' : 'people'}</Text>
        {bucket !== 'all' && (
          <TouchableOpacity onPress={() => setBucket('all')} hitSlop={8}><Text style={s.clearLink}>Show all</Text></TouchableOpacity>
        )}
      </View>
      <View style={s.bucketRow}>
        {BUCKETS.map((b) => {
          const active = bucket === b.key;
          return (
            <TouchableOpacity
              key={b.key}
              style={[s.bucketCard, active && { borderColor: b.color, backgroundColor: b.bg }]}
              onPress={() => setBucket(active ? 'all' : b.key)}
              activeOpacity={0.85}
            >
              <Ionicons name={b.icon} size={15} color={b.color} />
              <Text style={s.bucketVal}>{bucketCounts[b.key]}</Text>
              <Text style={s.bucketLbl} numberOfLines={1}>{b.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Upcoming leave ──────────────────────────────────────────────── */}
      {teamUpcoming.length > 0 && bucket === 'all' && !search && (
        <>
          <Text style={s.sectionLabel}>Upcoming Leave</Text>
          <View style={s.upCard}>
            {teamUpcoming.map((l) => {
              const m = byId.get(l.profile_id);
              const half = requestHalfDayLabel(l);
              return (
                <TouchableOpacity key={l.id} style={s.upRow} onPress={() => m && router.push(`/team-member?id=${m.id}` as any)} activeOpacity={0.8}>
                  <View style={[s.upDot, { backgroundColor: l.status === 'Approved' ? C.primary : C.purple }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.upName} numberOfLines={1}>{personName(m, 'EMPLOYEE')}</Text>
                    <Text style={s.upMeta} numberOfLines={1}>
                      {l.leave_type} · {fmtDate(l.start_date)}{l.end_date !== l.start_date ? ` – ${fmtDate(l.end_date)}` : ''}{half ? ` · ${half}` : ''}
                    </Text>
                  </View>
                  <Text style={[s.upStatus, { color: l.status === 'Approved' ? C.success : C.amber }]}>{l.status}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      {/* ── Members ─────────────────────────────────────────────────────── */}
      <Text style={s.sectionLabel}>Team Members</Text>
      <View style={s.searchBox}>
        <Ionicons name="search" size={16} color={C.muted} />
        <TextInput
          style={s.searchInput}
          placeholder="Search name, code or designation"
          placeholderTextColor={C.muted}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
        {!!search && <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}><Ionicons name="close-circle" size={16} color={C.muted} /></TouchableOpacity>}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageHeader
        title={hr ? 'Company' : 'My Team'}
        subtitle={subtitle}
        right={<View style={s.roleChip}><Text style={s.roleChipText}>{ROLE_LABEL[profile?.role || ''] || 'Approver'}</Text></View>}
      />

      {loading && !today ? (
        <View style={[s.list, s.loadingBox]}><ActivityIndicator color={C.primary} size="large" /></View>
      ) : (
        <SectionList
          style={s.list}
          sections={sections}
          keyExtractor={(m) => m.id}
          ListHeaderComponent={header}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 110 }}
          initialNumToRender={20}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
          renderSectionHeader={({ section }) => (
            <Text style={s.deptHead}>{section.title} <Text style={s.deptCount}>{section.data.length}</Text></Text>
          )}
          renderItem={({ item: m }) => {
            const st = statusById.get(m.id);
            const style = DAY_KIND_STYLE[st?.kind || 'none'];
            const { inAt, outAt } = firstInLastOut(st?.att);
            const leader = m.role === 'manager' || m.role === 'hod';
            const rt = reportsTo(m);
            return (
              <TouchableOpacity style={s.memberRow} onPress={() => router.push(`/team-member?id=${m.id}` as any)} activeOpacity={0.8}>
                <View style={[s.avatar, { backgroundColor: style.bg }]}>
                  <Text style={[s.avatarText, { color: style.color }]}>{initials(m)}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.memberName} numberOfLines={1}>
                    {personName(m)}{m.employee_id ? ` (${m.employee_id})` : ''}
                  </Text>
                  <Text style={s.memberMeta} numberOfLines={1}>
                    {[m.designation, leader ? 'Manager' : null, rt && rt !== 'You' && !hr ? `under ${rt}` : null].filter(Boolean).join(' · ') || '—'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  <View style={[s.statusPill, { backgroundColor: style.bg }]}>
                    <Text style={[s.statusPillText, { color: style.color }]}>{style.label}</Text>
                  </View>
                  {(inAt || outAt) && (
                    <Text style={s.timeText}>{inAt ? fmtTime12(inAt) : '—'}{outAt ? ` – ${fmtTime12(outAt)}` : ''}</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={(
            <View style={s.emptyCard}>
              <Ionicons name="people-outline" size={28} color={C.muted} />
              <Text style={s.emptyText}>
                {team.length === 0
                  ? (raniwala ? 'No one reports to you yet. HR sets reporting managers on each employee\'s profile.' : 'No one reports to you yet.')
                  : 'No one matches this filter.'}
              </Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.surface },
  list: { flex: 1, backgroundColor: C.bg },
  loadingBox: { alignItems: 'center', justifyContent: 'center' },
  roleChip: { backgroundColor: C.primaryBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  roleChipText: { fontSize: 11.5, fontWeight: '700', color: C.primary },
  inboxCard: { margin: 14, marginBottom: 4, backgroundColor: C.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border },
  inboxTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  inboxIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  inboxTitle: { fontSize: 16, fontWeight: '800', color: C.text },
  inboxSub: { fontSize: 12, color: C.muted, marginTop: 1 },
  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, rowGap: 12 },
  kindTile: { width: '25%', alignItems: 'center', gap: 5 },
  kindIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  kindBadge: { position: 'absolute', top: -5, right: -7, minWidth: 19, height: 19, borderRadius: 10, backgroundColor: C.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, borderWidth: 2, borderColor: C.surface },
  kindBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  kindLabel: { fontSize: 11.5, fontWeight: '700', color: C.text },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 20 },
  sectionLabel: { fontSize: 11.5, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: 20, marginTop: 18, marginBottom: 8 },
  clearLink: { fontSize: 12, fontWeight: '800', color: C.primary, marginTop: 10 },
  bucketRow: { flexDirection: 'row', gap: 7, paddingHorizontal: 14 },
  bucketCard: { flex: 1, alignItems: 'center', gap: 2, backgroundColor: C.surface, borderRadius: 12, paddingVertical: 10, borderWidth: 1, borderColor: C.border },
  bucketVal: { fontSize: 17, fontWeight: '800', color: C.text },
  bucketLbl: { fontSize: 10.5, fontWeight: '700', color: C.muted },
  upCard: { marginHorizontal: 14, backgroundColor: C.surface, borderRadius: 16, paddingVertical: 4, borderWidth: 1, borderColor: C.border },
  upRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  upDot: { width: 8, height: 8, borderRadius: 4 },
  upName: { fontSize: 13, fontWeight: '800', color: C.text },
  upMeta: { fontSize: 11.5, color: C.muted, marginTop: 1 },
  upStatus: { fontSize: 11.5, fontWeight: '800' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginBottom: 4, backgroundColor: C.surface, borderRadius: 14, paddingHorizontal: 12, borderWidth: 1, borderColor: C.border },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 13.5, color: C.text },
  deptHead: { fontSize: 12, fontWeight: '800', color: C.primaryDark, paddingHorizontal: 20, marginTop: 14, marginBottom: 6 },
  deptCount: { color: C.muted, fontWeight: '700' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginHorizontal: 14, marginBottom: 7, backgroundColor: C.surface, borderRadius: 14, padding: 11, borderWidth: 1, borderColor: C.border },
  avatar: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '800' },
  memberName: { fontSize: 13.5, fontWeight: '800', color: C.text },
  memberMeta: { fontSize: 11.5, color: C.muted, marginTop: 1 },
  statusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillText: { fontSize: 10.5, fontWeight: '800' },
  timeText: { fontSize: 10.5, color: C.muted, fontWeight: '600' },
  emptyCard: { margin: 14, backgroundColor: C.surface, borderRadius: 16, padding: 30, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.border },
  emptyText: { fontSize: 13, color: C.muted, textAlign: 'center' },
});
