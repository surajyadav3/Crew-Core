import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@/context/AuthContext';
import { useApprovals } from '@/context/ApprovalsContext';
import { useForegroundRefresh } from '@/hooks/useForegroundRefresh';
import { showToast } from '@/components/Toast';
import PageHeader from '@/components/PageHeader';
import { kindInfo, isHrRole, type ApprovalKind } from '@/lib/approvals';
import { requestHalfDayLabel } from '@/lib/halfDayLeave';
import {
  type StatusFilter,
  listTeamLeaves, decideLeave, canDecideLeave, isMultiStageLeave, myLeaveStage,
  listPunchApprovals, groupPunchDays, reviewPunches,
  listTeamRegularize, decideRegularize, canDecideTiered,
  listTeamWfh, decideWfh,
  listTeamSpecial, decideSpecial,
  listTeamExpenses, decideExpense, getReceiptUrl,
  listTeamTravel, decideTravel,
} from '@/services/approvalService';
import { fmt, fmtDate, fmtDateTime, fmtTime12, personName } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

/**
 * Team approvals inbox — the app's version of the website's Requests pages
 * (Leave / Punch / Regularize / WFH / Special / Expense / Travel). Rows are
 * kept together with the request type and status they were loaded for, and a
 * card is only drawn for rows of the tab on screen — switching tabs never
 * renders one request type's rows with another type's card.
 */

const STATUS_FILTERS: StatusFilter[] = ['Pending', 'Approved', 'Rejected', 'All'];

// The website's .badge-* colours.
const BADGE: Record<string, { color: string; bg: string }> = {
  pending: { color: '#B45309', bg: C.warningBg },
  approved: { color: '#047857', bg: C.successBg },
  rejected: { color: '#B91C1C', bg: C.dangerBg },
  skipped: { color: C.muted, bg: '#F1F5F9' },
  paid: { color: C.muted, bg: '#F1F5F9' },
};
const badgeFor = (status?: string) => BADGE[String(status || 'pending').toLowerCase()] || BADGE.pending;

// Raniwala leave approval chain, in order. 'Not Required' stages are hidden.
const STAGES = [
  { key: 'manager', label: 'Manager', status: 'manager_status', decider: 'manager_decider', at: 'manager_decided_at', assignee: 'stage_manager' },
  { key: 'hod', label: 'HOD', status: 'hod_status', decider: 'hod_decider', at: 'hod_decided_at', assignee: 'stage_hod' },
  { key: 'hr', label: 'HR', status: 'hr_status', decider: 'hr_decider', at: 'hr_decided_at', assignee: null },
  { key: 'management', label: 'Management', status: 'management_status', decider: 'management_decider', at: 'management_decided_at', assignee: null },
];
const STAGE_LABEL: Record<string, string> = Object.fromEntries(STAGES.map((st) => [st.key, st.label]));

// The website's getAvatarColor palette (first colour of each gradient).
const AVATAR = ['#6C5CE7', '#0891B2', '#10B981', '#F59E0B', '#E11D48', '#8B5CF6', '#5849C2', '#0EA5E9'];
const avatarColor = (id?: string) => AVATAR[[...(id || '')].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR.length];

const dayCount = (from: string, to: string) => {
  const [sy, sm, sd] = String(from).split('-').map(Number);
  const [ey, em, ed] = String(to).split('-').map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1;
};

const roleLabel = (role?: string) => (role === 'admin' ? 'HR' : role === 'hod' ? 'HOD' : role === 'manager' ? 'Manager' : role || '');

/** Who a pending leave is waiting on, e.g. "HOD: RAHUL SHARMA". */
function waitingOn(req: any) {
  if (!req.current_stage) return req.required_approver_role === 'admin' ? 'HR' : roleLabel(req.required_approver_role);
  const who = req.current_stage === 'manager' ? req.stage_manager : req.current_stage === 'hod' ? req.stage_hod : null;
  return `${STAGE_LABEL[req.current_stage] || req.current_stage}${who ? `: ${personName(who)}` : ''}`;
}

/** Name, code and department line for any request type's row. */
function personOf(kind: ApprovalKind, r: any) {
  if (kind === 'punch') {
    return {
      id: r.profile_id,
      name: String(r.employee_name || 'EMPLOYEE').toUpperCase(),
      code: r.employee_code,
      sub: [r.department, r.outlet_name].filter(Boolean).join(' · '),
    };
  }
  return {
    id: r.profile_id,
    name: personName(r.profile, 'EMPLOYEE'),
    code: r.profile?.employee_id,
    sub: [r.profile?.designation, r.profile?.department].filter(Boolean).join(' · '),
  };
}

type Loaded = { kind: ApprovalKind; status: StatusFilter; rows: any[] };

export default function ApprovalsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string }>();
  const { profile, tenant } = useAuth();
  const { kinds, counts, total, refresh: refreshCounts } = useApprovals();

  const listKinds: ApprovalKind[] = kinds.filter((k) => k !== 'verification');
  const pick = (k?: string) => (listKinds.includes(k as ApprovalKind) ? (k as ApprovalKind) : listKinds[0]);
  const [kind, setKind] = useState<ApprovalKind | undefined>(pick(params.kind));
  const [status, setStatus] = useState<StatusFilter>('Pending');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // A notification tap while this screen is open switches to its tab.
  useEffect(() => { if (params.kind) setKind(pick(params.kind)); }, [params.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!kind && listKinds.length) setKind(listKinds[0]); }, [kind, listKinds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchRows = useCallback(async () => {
    if (!profile || !tenant || !kind) return;
    const me = profile.id;
    const forKind = kind;
    const forStatus = status;
    let res: { data: any[]; error: any };
    switch (forKind) {
      case 'leave': res = await listTeamLeaves(tenant.id, me, forStatus); break;
      case 'punch': {
        const r = await listPunchApprovals(forStatus);
        res = { data: groupPunchDays(r.data.filter((p) => p.profile_id !== me)), error: r.error };
        break;
      }
      case 'regularize': res = await listTeamRegularize(tenant.id, me, forStatus); break;
      case 'wfh': res = await listTeamWfh(tenant.id, me, forStatus); break;
      case 'special': res = await listTeamSpecial(tenant.id, me, forStatus); break;
      case 'expense': res = await listTeamExpenses(tenant.id, me, forStatus); break;
      case 'travel': res = await listTeamTravel(tenant.id, me, forStatus); break;
      default: res = { data: [], error: null };
    }
    if (res.error) showToast(res.error.message || 'Could not load requests.', 'error');
    setLoaded({ kind: forKind, status: forStatus, rows: res.data || [] });
  }, [profile, tenant, kind, status]);

  // Refetches on focus, on return to the foreground, and whenever the type / status tab changes.
  useForegroundRefresh(fetchRows, setLoading);
  useEffect(() => { setSelected(new Set()); setSelectMode(false); }, [kind, status]);

  // Only rows loaded for the tab on screen — a slow earlier load can't leak in.
  const rows = loaded && loaded.kind === kind && loaded.status === status ? loaded.rows : null;

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchRows(), refreshCounts(true)]);
    setRefreshing(false);
  };

  /** Same gates as the website's per-row Approve / Reject buttons. */
  const canAct = useCallback((r: any) => {
    switch (kind) {
      case 'leave': return canDecideLeave(r, profile, tenant);
      case 'punch': return (r.pendingIds || []).length > 0;
      case 'regularize':
      case 'special': return canDecideTiered(r, profile);
      default: return r.status === 'Pending';
    }
  }, [kind, profile, tenant]);

  const mine = useMemo(() => (rows && (status === 'Pending' || status === 'All') ? rows.filter(canAct) : []), [rows, canAct, status]);
  const others = useMemo(() => (rows ? rows.filter((r) => !mine.includes(r)) : []), [rows, mine]);

  const decideOne = async (r: any, approve: boolean) => {
    if (!profile || !tenant) return { error: new Error('Not signed in') };
    switch (kind) {
      case 'leave': return decideLeave(r, approve, profile, tenant);
      case 'punch': return reviewPunches(r.pendingIds || [], approve);
      case 'regularize': return decideRegularize(r, approve, profile);
      case 'wfh': return decideWfh(r, approve, profile);
      case 'special': return decideSpecial(r, approve, profile);
      case 'expense': return decideExpense(r, approve, profile);
      case 'travel': return decideTravel(r, approve, profile);
      default: return { error: new Error('Unknown request type') };
    }
  };

  const afterDecision = async () => { await Promise.all([fetchRows(), refreshCounts(true)]); };

  const successText = (approve: boolean) => {
    if (kind === 'punch') return approve ? 'Approved — hours now count in attendance.' : 'Rejected — those punches won\'t count.';
    if (kind === 'regularize' && approve) return 'Approved — attendance updated.';
    if (kind === 'wfh' && approve) return 'WFH approved — geofence is skipped on those dates.';
    if (kind === 'leave' && approve) return 'Leave approved — balance updated.';
    return approve ? 'Request approved.' : 'Request rejected.';
  };

  // HR deciding ahead of the Manager / HOD is allowed but final — say so first.
  const hrEarlyNote = (list: any[]) => {
    if (kind !== 'leave' || !isHrRole(profile?.role)) return '';
    const early = list.filter((r) => isMultiStageLeave(r, tenant) && myLeaveStage(r, profile) === 'hr' && r.current_stage !== 'hr').length;
    if (!early) return '';
    return early === 1 && list.length === 1
      ? `\n\nThis is still waiting on ${waitingOn(list[0])}. Your HR decision is final and skips them.`
      : `\n\n${early} of these are still waiting on another approver. Your HR decision is final and skips them.`;
  };

  const runOne = async (r: any, approve: boolean) => {
    setBusyId(r.id);
    const { error } = await decideOne(r, approve);
    setBusyId(null);
    if (error) showToast(error.message || 'Something went wrong.', 'error');
    else showToast(successText(approve), approve ? 'success' : 'info');
    await afterDecision();
  };

  const onDecide = (r: any, approve: boolean) => {
    const note = hrEarlyNote([r]);
    if (approve && !note) { runOne(r, true); return; }
    const p = personOf(kind!, r);
    Alert.alert(
      approve ? 'Approve this request?' : 'Reject this request?',
      `${p.name}${p.code ? ` (${p.code})` : ''}${note}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: approve ? 'Approve' : 'Reject', style: approve ? 'default' : 'destructive', onPress: () => runOne(r, approve) },
      ],
    );
  };

  const toggleSelected = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const runBulk = async (approve: boolean) => {
    const list = mine.filter((r) => selected.has(r.id));
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    if (kind === 'punch') {
      // review_punches takes a list, so every selected day goes in one call.
      const { error } = await reviewPunches(list.flatMap((d) => d.pendingIds || []), approve);
      if (error) failed = list.length; else ok = list.length;
    } else {
      for (const r of list) {
        const { error } = await decideOne(r, approve);
        if (error) failed++; else ok++;
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    setSelectMode(false);
    showToast(
      failed ? `${ok} ${approve ? 'approved' : 'rejected'}, ${failed} failed — refresh and retry.` : `${ok} request${ok !== 1 ? 's' : ''} ${approve ? 'approved' : 'rejected'}.`,
      failed ? 'error' : 'success',
    );
    await afterDecision();
  };

  const onBulk = (approve: boolean) => {
    const list = mine.filter((r) => selected.has(r.id));
    if (!list.length || !kind) return;
    Alert.alert(
      `${approve ? 'Approve' : 'Reject'} ${list.length} request${list.length !== 1 ? 's' : ''}?`,
      `Every selected ${kindInfo(kind).short.toLowerCase()} request will be ${approve ? 'approved' : 'rejected'}.${hrEarlyNote(list)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: approve ? 'Approve all' : 'Reject all', style: approve ? 'default' : 'destructive', onPress: () => runBulk(approve) },
      ],
    );
  };

  // ── Card bodies per request type ───────────────────────────────────────────

  const Detail = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <View style={s.detail}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{children}</Text>
    </View>
  );

  const openReceipt = async (path: string) => {
    const { url, error } = await getReceiptUrl(path);
    if (error || !url) { showToast('Could not open the receipt.', 'error'); return; }
    WebBrowser.openBrowserAsync(url);
  };

  const renderBody = (r: any) => {
    switch (kind) {
      case 'leave': {
        const half = requestHalfDayLabel(r);
        const days = half ? 0.5 : dayCount(r.start_date, r.end_date);
        const multi = isMultiStageLeave(r, tenant);
        return (
          <>
            <View style={s.tagRow}>
              <View style={[s.tag, { backgroundColor: C.tealBg }]}><Text style={[s.tagText, { color: C.teal }]}>{r.leave_type || 'Leave'}</Text></View>
              <Text style={s.tagMeta}>{days} day{days !== 1 ? 's' : ''}</Text>
              {multi && r.short_notice && (
                <View style={[s.tag, { backgroundColor: C.warningBg }]}><Text style={[s.tagText, { color: '#B45309' }]}>Short notice</Text></View>
              )}
            </View>
            <Detail label="Dates">
              {fmtDate(r.start_date)}{r.start_date !== r.end_date ? ` – ${fmtDate(r.end_date)}` : ''}{half ? `\n${half}` : ''}
            </Detail>
            {r.unpaid_days > 0 && <Detail label="Unpaid">{r.unpaid_days} day{r.unpaid_days !== 1 ? 's' : ''} Loss of Pay</Detail>}
            {!!r.reason && <Detail label="Reason">{r.reason}</Detail>}
            <Detail label="Applied">{fmtDate(r.created_at)}</Detail>
            {multi && (
              <View style={s.trail}>
                {STAGES.map((st) => {
                  const value = r[st.status];
                  if (!value || value === 'Not Required') return null;
                  const b = badgeFor(value);
                  const who = r[st.decider] ? personName(r[st.decider]) : st.assignee && r[st.assignee] ? personName(r[st.assignee]) : '';
                  return (
                    <View key={st.key} style={s.trailRow}>
                      <View style={[s.trailDot, { backgroundColor: b.color }]} />
                      <Text style={s.trailStage}>{st.label}</Text>
                      <Text style={s.trailWho} numberOfLines={1}>
                        {value}{who ? ` · ${who}` : ''}{value === 'Skipped' ? ' · decided by HR' : ''}{r[st.at] ? ` · ${fmtDate(r[st.at])}` : ''}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
            {!multi && r.status !== 'Pending' && (
              <Text style={s.byText}>{r.approval_level === 'self' ? 'Auto-approved' : r.approver ? `By ${personName(r.approver)}` : ''}</Text>
            )}
          </>
        );
      }
      case 'punch': {
        const punches: any[] = r.punches || [];
        const reviewed = punches.find((p) => p.reviewed_at);
        return (
          <>
            <Detail label="Date">{fmtDate(r.date)}</Detail>
            <View style={s.punchBox}>
              {punches.map((p) => {
                const b = badgeFor(p.approval_status);
                const isIn = p.punch_type === 'in';
                return (
                  <View key={p.punch_id} style={s.punchRow}>
                    <View style={[s.punchIcon, { backgroundColor: isIn ? C.successBg : C.dangerBg }]}>
                      <Ionicons name={isIn ? 'log-in-outline' : 'log-out-outline'} size={14} color={isIn ? C.success : C.danger} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.punchTime}>{isIn ? 'Clock in' : 'Clock out'} · {fmtTime12(p.punch_time)}</Text>
                      {p.out_of_geofence && <Text style={s.punchWarn}>Outside the office location</Text>}
                    </View>
                    <View style={[s.badge, { backgroundColor: b.bg }]}><Text style={[s.badgeText, { color: b.color }]}>{p.approval_status}</Text></View>
                    {p.lat != null && p.lng != null && (
                      <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps?q=${p.lat},${p.lng}`)} hitSlop={8} accessibilityLabel="Open punch location">
                        <Ionicons name="location-outline" size={18} color={C.primary} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
            <Detail label="Approver">{r.approver_name || 'HR'}</Detail>
            {reviewed && <Text style={s.byText}>Reviewed by {reviewed.reviewed_by_name} · {fmtDateTime(reviewed.reviewed_at)}</Text>}
          </>
        );
      }
      case 'regularize':
        return (
          <>
            <Detail label="Date">{fmtDate(r.date)}</Detail>
            <Detail label="Times">
              {r.clock_in_time ? fmtTime12(r.clock_in_time) : '—'}  →  {r.clock_out_time ? fmtTime12(r.clock_out_time) : '—'}
            </Detail>
            {!!r.reason && <Detail label="Reason">{r.reason}</Detail>}
            <Detail label="Submitted">{fmtDateTime(r.created_at)}</Detail>
            {r.status !== 'Pending' && (
              <Text style={s.byText}>
                {r.approval_level === 'self' ? 'Auto-approved' : r.reviewer ? `By ${personName(r.reviewer)} (${roleLabel(r.reviewer.role)})${r.reviewed_at ? ` · ${fmtDateTime(r.reviewed_at)}` : ''}` : ''}
              </Text>
            )}
          </>
        );
      case 'wfh': {
        const days = dayCount(r.from_date, r.to_date);
        return (
          <>
            <Detail label="Dates">{fmtDate(r.from_date)}{r.from_date !== r.to_date ? ` – ${fmtDate(r.to_date)}` : ''} · {days} day{days !== 1 ? 's' : ''}</Detail>
            {!!r.reason && <Detail label="Reason">{r.reason}</Detail>}
            <Detail label="Submitted">{fmtDate(r.created_at)}</Detail>
            {r.status !== 'Pending' && r.reviewer && <Text style={s.byText}>By {personName(r.reviewer)}{r.reviewed_at ? ` · ${fmtDateTime(r.reviewed_at)}` : ''}</Text>}
          </>
        );
      }
      case 'special':
        return (
          <>
            <View style={s.tagRow}>
              <View style={[s.tag, { backgroundColor: '#EDE9FE' }]}><Text style={[s.tagText, { color: C.purple }]}>{r.request_type}</Text></View>
            </View>
            <Detail label="Date">{fmtDate(r.request_date)}</Detail>
            {r.request_type === 'Late Arrival' && !!r.late_hours && <Detail label="Late by">{r.late_hours}</Detail>}
            {r.request_type === 'Salary Overtime' && r.overtime_minutes != null && (
              <Detail label="Overtime">{Math.floor(r.overtime_minutes / 60)}h {r.overtime_minutes % 60}m · {r.overtime_hours || 0}h payable</Detail>
            )}
            {!!r.reason && <Detail label="Reason">{r.reason}</Detail>}
            {r.status !== 'Pending' && (
              <Text style={s.byText}>{r.approval_level === 'self' ? 'Auto-approved' : r.approver ? `By ${personName(r.approver)}` : ''}</Text>
            )}
          </>
        );
      case 'expense':
        return (
          <>
            <Text style={s.amount}>{fmt(Number(r.total_amount) || 0)}</Text>
            {(r.items || []).map((it: any) => (
              <View key={it.id} style={s.itemRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.itemCat}>{it.category}</Text>
                  {!!it.description && <Text style={s.itemDesc}>{it.description}</Text>}
                </View>
                <Text style={s.itemAmt}>{fmt(Number(it.amount) || 0)}</Text>
                {!!it.receipt_path && (
                  <TouchableOpacity onPress={() => openReceipt(it.receipt_path)} hitSlop={8} accessibilityLabel="Open receipt">
                    <Ionicons name="document-attach-outline" size={18} color={C.primary} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <Detail label="Submitted">{fmtDate(r.created_at)}</Detail>
          </>
        );
      case 'travel':
        return (
          <>
            {!!r.purpose && <Detail label="Purpose">{r.purpose}</Detail>}
            <Detail label="Dates">{fmtDate(r.from_date)}{r.to_date && r.to_date !== r.from_date ? ` – ${fmtDate(r.to_date)}` : ''}</Detail>
            {Number(r.estimated_cost) > 0 && <Detail label="Estimate">{fmt(Number(r.estimated_cost))}</Detail>}
            {(r.legs || []).map((l: any, i: number) => (
              <Detail key={l.id || i} label={i === 0 ? 'Route' : ''}>{l.from_city} → {l.to_city} · {l.mode}{l.travel_date ? ` · ${fmtDate(l.travel_date)}` : ''}</Detail>
            ))}
          </>
        );
      default:
        return null;
    }
  };

  const renderCard = (r: any, actionable: boolean) => {
    if (!kind) return null;
    const p = personOf(kind, r);
    const statusValue = kind === 'punch'
      ? ((r.pendingIds || []).length ? 'pending' : (r.punches || [])[0]?.approval_status || 'approved')
      : r.status;
    const b = badgeFor(statusValue);
    const isSelected = selected.has(r.id);
    const busy = busyId === r.id || bulkBusy;
    const finalHr = kind === 'leave' && myLeaveStage(r, profile) === 'hr' && r.current_stage && r.current_stage !== 'hr';

    return (
      <TouchableOpacity
        key={r.id}
        style={[s.card, isSelected && s.cardSelected]}
        activeOpacity={selectMode && actionable ? 0.7 : 1}
        onPress={() => { if (selectMode && actionable) toggleSelected(r.id); }}
        onLongPress={() => { if (actionable) { setSelectMode(true); toggleSelected(r.id); } }}
      >
        <View style={s.cardTop}>
          {selectMode && actionable ? (
            <Ionicons name={isSelected ? 'checkbox' : 'square-outline'} size={24} color={isSelected ? C.primary : C.muted} />
          ) : (
            <View style={[s.avatar, { backgroundColor: avatarColor(p.id) }]}>
              <Text style={s.avatarText}>{p.name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('')}</Text>
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.name} numberOfLines={1}>{p.name}</Text>
            <Text style={s.meta} numberOfLines={1}>{[p.code ? `EMP ${p.code}` : null, p.sub].filter(Boolean).join(' · ') || '—'}</Text>
          </View>
          <View style={[s.badge, { backgroundColor: b.bg }]}><Text style={[s.badgeText, { color: b.color }]}>{String(statusValue)}</Text></View>
        </View>

        <View style={s.cardBody}>{renderBody(r)}</View>

        {!actionable && r.status === 'Pending' && kind === 'leave' && (
          <View style={s.waiting}>
            <Ionicons name="hourglass-outline" size={13} color="#B45309" />
            <Text style={s.waitingText} numberOfLines={2}>Waiting on {waitingOn(r)}</Text>
          </View>
        )}
        {!actionable && r.status === 'Pending' && (kind === 'regularize' || kind === 'special') && r.required_approver_role && r.required_approver_role !== 'manager' && (
          <View style={s.waiting}>
            <Ionicons name="hourglass-outline" size={13} color="#B45309" />
            <Text style={s.waitingText}>Awaiting {r.required_approver_role === 'admin' ? 'HR' : r.required_approver_role}</Text>
          </View>
        )}

        {actionable && !selectMode && (
          <View style={s.actions}>
            <TouchableOpacity style={[s.btn, s.rejectBtn]} disabled={busy} onPress={() => onDecide(r, false)} activeOpacity={0.85}>
              <Ionicons name="close" size={16} color={C.danger} />
              <Text style={[s.btnText, { color: C.danger }]}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.approveBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => onDecide(r, true)} activeOpacity={0.85}>
              {busyId === r.id ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Ionicons name="checkmark" size={16} color="#fff" />
                  <Text style={[s.btnText, { color: '#fff' }]}>
                    {kind === 'punch' && (r.pendingIds || []).length > 1 ? 'Approve both' : finalHr ? 'Approve (final)' : 'Approve'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const subtitle = total > 0 ? `${total} request${total !== 1 ? 's' : ''} waiting on you` : 'All caught up';

  if (!kind) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <PageHeader title="Approvals" subtitle="Nothing to review" onBack={() => router.back()} />
        <View style={s.page}>
          <View style={s.empty}>
            <Ionicons name="file-tray-outline" size={30} color={C.muted} />
            <Text style={s.emptyText}>No request types are switched on for your company.</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const info = kindInfo(kind);
  const selectedCount = mine.filter((r) => selected.has(r.id)).length;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageHeader title="Approvals" subtitle={subtitle} onBack={() => router.back()} />

      {/* Request types — the website's Requests flyout */}
      <View style={s.kindBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.kindScroll}>
          {listKinds.map((k) => {
            const ki = kindInfo(k);
            const active = k === kind;
            const n = counts[k] || 0;
            return (
              <TouchableOpacity
                key={k}
                style={[s.kindTab, active && s.kindTabActive]}
                onPress={() => { if (k !== kind) setKind(k); }}
                activeOpacity={0.85}
              >
                <Ionicons name={ki.icon} size={15} color={active ? C.primary : C.muted} />
                <Text style={[s.kindTabText, active && s.kindTabTextActive]}>{ki.short}</Text>
                {n > 0 && <View style={s.count}><Text style={s.countText}>{n > 99 ? '99+' : n}</Text></View>}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <View style={s.statusRow}>
          {STATUS_FILTERS.map((f) => (
            <TouchableOpacity key={f} style={[s.statusTab, status === f && s.statusTabActive]} onPress={() => setStatus(f)} activeOpacity={0.85}>
              <Text style={[s.statusText, status === f && s.statusTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={s.page}>
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: selectMode ? 110 : 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
        >
          {rows === null || (loading && rows.length === 0) ? (
            <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>
          ) : rows.length === 0 ? (
            <View style={s.empty}>
              <View style={[s.emptyIcon, { backgroundColor: info.bg }]}><Ionicons name={info.icon} size={26} color={info.color} /></View>
              <Text style={s.emptyTitle}>{status === 'Pending' ? 'All caught up' : 'Nothing here'}</Text>
              <Text style={s.emptyText}>No {status !== 'All' ? status.toLowerCase() : ''} {info.label.toLowerCase()}.</Text>
            </View>
          ) : (
            <>
              {mine.length > 0 && (
                <View style={s.sectionRow}>
                  <Text style={s.section}>{status === 'Pending' ? 'Needs your approval' : 'Open'} · {mine.length}</Text>
                  {mine.length > 1 && (
                    <TouchableOpacity
                      onPress={() => {
                        if (selectMode) { setSelectMode(false); setSelected(new Set()); }
                        else { setSelectMode(true); setSelected(new Set(mine.map((r) => r.id))); }
                      }}
                      hitSlop={8}
                    >
                      <Text style={s.selectLink}>{selectMode ? 'Cancel' : 'Select all'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              {mine.map((r) => renderCard(r, true))}
              {others.length > 0 && (
                <View style={s.sectionRow}>
                  <Text style={s.section}>{status === 'Pending' ? 'Waiting on others' : status === 'All' ? 'Decided' : status} · {others.length}</Text>
                </View>
              )}
              {others.map((r) => renderCard(r, false))}
              {status !== 'Pending' && rows.length >= 60 && <Text style={s.footNote}>Showing the latest 60.</Text>}
            </>
          )}
        </ScrollView>

        {selectMode && (
          <View style={s.bulkBar}>
            <Text style={s.bulkText}>{selectedCount} selected</Text>
            <TouchableOpacity style={[s.bulkBtn, s.rejectBtn]} disabled={!selectedCount || bulkBusy} onPress={() => onBulk(false)} activeOpacity={0.85}>
              <Text style={[s.btnText, { color: C.danger }]}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.bulkBtn, s.approveBtn, !selectedCount && { opacity: 0.5 }]} disabled={!selectedCount || bulkBusy} onPress={() => onBulk(true)} activeOpacity={0.85}>
              {bulkBusy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={[s.btnText, { color: '#fff' }]}>Approve</Text>}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.surface },
  page: { flex: 1, backgroundColor: C.bg },
  kindBar: { backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  kindScroll: { paddingHorizontal: 12, paddingTop: 10, gap: 6 },
  kindTab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  kindTabActive: { backgroundColor: C.primaryBg },
  kindTabText: { fontSize: 13, fontWeight: '600', color: C.muted },
  kindTabTextActive: { color: C.primary, fontWeight: '700' },
  count: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  countText: { fontSize: 10.5, fontWeight: '700', color: '#fff' },
  statusRow: { flexDirection: 'row', paddingHorizontal: 12, marginTop: 6 },
  statusTab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  statusTabActive: { borderBottomColor: C.primary },
  statusText: { fontSize: 13, fontWeight: '600', color: C.muted },
  statusTextActive: { color: C.primary, fontWeight: '700' },
  loadingBox: { padding: 60, alignItems: 'center' },
  empty: { margin: 16, backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 32, alignItems: 'center', gap: 8 },
  emptyIcon: { width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  emptyText: { fontSize: 13, color: C.muted, textAlign: 'center' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, marginTop: 16, marginBottom: 8 },
  section: { fontSize: 12, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  selectLink: { fontSize: 13, fontWeight: '700', color: C.primary },
  footNote: { fontSize: 12, color: C.muted, textAlign: 'center', marginTop: 6 },
  card: {
    marginHorizontal: 14, marginBottom: 10, backgroundColor: C.surface, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: C.border, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  cardSelected: { borderColor: C.primary, backgroundColor: '#FAF8FF' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  name: { fontSize: 14, fontWeight: '700', color: C.text },
  meta: { fontSize: 12, color: C.muted, marginTop: 1 },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  cardBody: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F1F5F9', gap: 8 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  tag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontSize: 12, fontWeight: '700' },
  tagMeta: { fontSize: 13, fontWeight: '700', color: C.text },
  detail: { flexDirection: 'row', gap: 10 },
  detailLabel: { width: 74, fontSize: 12.5, color: C.muted },
  detailValue: { flex: 1, fontSize: 13, color: C.text, lineHeight: 18 },
  byText: { fontSize: 12, color: C.muted },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, backgroundColor: C.warningBg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  waitingText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: '#B45309' },
  trail: { gap: 6, backgroundColor: C.bg, borderRadius: 10, padding: 10 },
  trailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  trailDot: { width: 7, height: 7, borderRadius: 4 },
  trailStage: { width: 78, fontSize: 12, fontWeight: '700', color: C.text },
  trailWho: { flex: 1, fontSize: 12, color: C.muted },
  punchBox: { gap: 8, backgroundColor: C.bg, borderRadius: 10, padding: 10 },
  punchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  punchIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  punchTime: { fontSize: 13, fontWeight: '600', color: C.text },
  punchWarn: { fontSize: 11.5, color: C.danger, marginTop: 1 },
  amount: { fontSize: 20, fontWeight: '800', color: C.text },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.bg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  itemCat: { fontSize: 12.5, fontWeight: '700', color: C.primary },
  itemDesc: { fontSize: 12.5, color: C.text, marginTop: 1 },
  itemAmt: { fontSize: 13, fontWeight: '700', color: C.text },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingVertical: 11 },
  rejectBtn: { backgroundColor: C.surface, borderWidth: 1, borderColor: '#FECACA' },
  approveBtn: { backgroundColor: C.success },
  btnText: { fontSize: 13.5, fontWeight: '700' },
  bulkBar: {
    position: 'absolute', left: 12, right: 12, bottom: 16, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface, borderRadius: 16, padding: 10, borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, elevation: 10,
  },
  bulkText: { flex: 1, fontSize: 13.5, fontWeight: '700', color: C.text, paddingLeft: 6 },
  bulkBtn: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minWidth: 92 },
});
