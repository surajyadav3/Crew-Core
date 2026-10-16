import { supabase } from '@/lib/supabase';
import { dateStr, getTenantWeeklyOffDays } from '@/lib/helpers';
import { requestHalfDayLabel } from '@/lib/halfDayLeave';
import { isHrRole } from '@/lib/approvals';

/**
 * Team views for managers / HODs / HR — mirrors the website's
 * src/services/teamService.js + MyTeamPage day rules. Lists are read
 * tenant-wide by date and narrowed to the team on the device, so no request
 * ever carries a long list of ids in its URL; RLS already limits Raniwala
 * managers / HODs to my_team_ids().
 */

const DIRECTORY_COLS = 'id, first_name, middle_name, last_name, employee_id, role, status, department, designation, manager_id, hod_id, outlet_id, outlet_location';

/**
 * Everyone below `rootId` in the manager_id tree (any depth), plus anyone
 * whose hod_id is `rootId` and their trees — the set my_team_ids() returns.
 */
export function collectTeam(directory: any[], rootId: string) {
  const byManager = new Map<string, any[]>();
  directory.forEach((p) => {
    if (!p.manager_id) return;
    if (!byManager.has(p.manager_id)) byManager.set(p.manager_id, []);
    byManager.get(p.manager_id)!.push(p);
  });
  const seen = new Set([rootId]);
  const out: any[] = [];
  const queue = [...(byManager.get(rootId) || []), ...directory.filter((p) => p.hod_id === rootId)];
  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
    queue.push(...(byManager.get(p.id) || []));
  }
  return out;
}

export type DayKind = 'present' | 'late' | 'half' | 'absent' | 'mispunch' | 'leave' | 'leave-pending' | 'wfh' | 'off' | 'holiday' | 'none' | 'pending-approval';

export const DAY_KIND_STYLE: Record<DayKind, { label: string; color: string; bg: string }> = {
  present: { label: 'Present', color: '#10B981', bg: '#D1FAE5' },
  late: { label: 'Late', color: '#D97706', bg: '#FEF3C7' },
  half: { label: 'Half Day', color: '#0891B2', bg: '#E0F2FE' },
  absent: { label: 'Absent', color: '#EF4444', bg: '#FEE2E2' },
  mispunch: { label: 'Mispunch', color: '#DB2777', bg: '#FCE7F3' },
  leave: { label: 'On Leave', color: '#6C5CE7', bg: '#EDE9FE' },
  'leave-pending': { label: 'Leave Pending', color: '#8B5CF6', bg: '#F5F3FF' },
  wfh: { label: 'WFH', color: '#E11D48', bg: '#FFE4E6' },
  off: { label: 'Weekly Off', color: '#64748B', bg: '#F1F5F9' },
  holiday: { label: 'Holiday', color: '#5849C2', bg: '#DDD6FE' },
  'pending-approval': { label: 'Punch Pending', color: '#D97706', bg: '#FEF3C7' },
  none: { label: 'Not In Yet', color: '#94A3B8', bg: '#F1F5F9' },
};

const inRange = (ds: string, from: string, to: string) => ds >= from && ds <= to;

type DayContext = {
  tenant: any;
  today: string;
  attendance: any[];
  leaves: any[];
  wfh: any[];
  holidays: any[];
  outlets: any[];
  joinDates?: Map<string, string | null>;
};

/** Builds `(member, date) => { kind, title }` — the website MyTeamPage's dayKind(). */
export function makeDayKind(ctx: DayContext) {
  const outletById = new Map(ctx.outlets.map((o) => [o.id, o]));
  const attByKey = new Map(ctx.attendance.map((a) => [`${a.profile_id}|${a.date}`, a]));

  return (m: any, d: Date): { kind: DayKind; title: string; att?: any } => {
    const ds = dateStr(d);
    // An outlet with holidays switched off (outlets.holidays_enabled) only gets its weekly off.
    const holiday = outletById.get(m.outlet_id)?.holidays_enabled !== false
      && ctx.holidays.find((h) => (h.date || h.holiday_date) === ds && (!h.outlet_id || h.outlet_id === m.outlet_id));
    if (holiday) return { kind: 'holiday', title: holiday.name || 'Holiday' };
    const leave = ctx.leaves.find((l) => l.profile_id === m.id && inRange(ds, l.start_date, l.end_date));
    const att = attByKey.get(`${m.id}|${ds}`);
    if (leave) {
      const half = requestHalfDayLabel(leave);
      // A half-day leave is still a worked day — keep the punches in view.
      if (!half || !att) {
        return { kind: leave.status === 'Approved' ? 'leave' : 'leave-pending', title: `${leave.leave_type}${half ? ` — ${half}` : ''}`, att };
      }
    }
    if (ctx.wfh.some((w) => w.profile_id === m.id && inRange(ds, w.from_date, w.to_date))) return { kind: 'wfh', title: 'Work from home', att };
    if (getTenantWeeklyOffDays(ctx.tenant, outletById.get(m.outlet_id)).includes(d.getDay()) && !att) return { kind: 'off', title: 'Weekly off' };
    if (att) {
      if (att.status === 'Late') return { kind: 'late', title: 'Late', att };
      if (att.status === 'Half Day') return { kind: 'half', title: 'Half day', att };
      if (att.status === 'Mispunch') return { kind: 'mispunch', title: 'Mispunch — only one punch', att };
      if (att.status === 'Absent') return { kind: 'absent', title: 'Absent', att };
      if (att.status === 'Leave') return { kind: 'leave', title: 'Leave', att };
      if (att.status === 'Pending Approval') return { kind: 'pending-approval', title: 'Punch awaiting approval', att };
      return { kind: 'present', title: att.status || 'Present', att };
    }
    const joined = ctx.joinDates?.get(m.id);
    if (ds < ctx.today && (!joined || ds >= joined)) return { kind: 'absent', title: 'No attendance' };
    return { kind: 'none', title: ds === ctx.today ? 'Not clocked in yet' : '' };
  };
}

/** The signed-in approver's team: their reporting tree, or every active employee for HR. */
export async function fetchMyTeam(tenantId: string, me: any) {
  const { data, error } = await supabase
    .from('profile_directory')
    .select(DIRECTORY_COLS)
    .eq('tenant_id', tenantId);
  const directory = (data || []) as any[];
  const team = isHrRole(me.role)
    ? directory.filter((p) => p.id !== me.id && p.role !== 'superadmin')
    : collectTeam(directory, me.id);
  return { directory, team: team.filter((p) => p.status === 'Active'), error };
}

/** Today's status inputs for the whole team, one query per table. */
export async function fetchTeamToday(tenantId: string) {
  const today = dateStr(new Date());
  const [attendance, leaves, wfh, holidays, outlets] = await Promise.all([
    supabase.from('attendance').select('profile_id, date, status, total_hours, punches(punch_time, punch_type)')
      .eq('tenant_id', tenantId).eq('date', today),
    supabase.from('leave_requests')
      .select('id, profile_id, leave_type, start_date, end_date, status, current_stage, half_day, half_day_from, half_day_to')
      .eq('tenant_id', tenantId).in('status', ['Pending', 'Approved'])
      .lte('start_date', today).gte('end_date', today),
    supabase.from('wfh_requests').select('profile_id, from_date, to_date')
      .eq('tenant_id', tenantId).eq('status', 'Approved').lte('from_date', today).gte('to_date', today),
    supabase.from('holidays').select('*').eq('tenant_id', tenantId).eq('date', today),
    supabase.from('outlets').select('id, name, weekly_off_days, holidays_enabled').eq('tenant_id', tenantId),
  ]);
  return {
    today,
    attendance: (attendance.data || []) as any[],
    leaves: (leaves.data || []) as any[],
    wfh: (wfh.data || []) as any[],
    holidays: (holidays.data || []) as any[],
    outlets: (outlets.data || []) as any[],
    error: attendance.error || leaves.error || wfh.error || holidays.error || outlets.error,
  };
}

/** Team leave from tomorrow for the next `days` days (approved + pending), soonest first. */
export async function fetchTeamUpcomingLeaves(tenantId: string, days = 30) {
  const from = new Date();
  from.setDate(from.getDate() + 1);
  const until = new Date();
  until.setDate(until.getDate() + days);
  const { data, error } = await supabase
    .from('leave_requests')
    .select('id, profile_id, leave_type, start_date, end_date, status, half_day, half_day_from, half_day_to')
    .eq('tenant_id', tenantId)
    .in('status', ['Pending', 'Approved'])
    .gte('end_date', dateStr(from))
    .lte('start_date', dateStr(until))
    .order('start_date', { ascending: true })
    .limit(100);
  return { data: (data || []) as any[], error };
}

/** One team member's month: their attendance, leave, WFH, holidays and contact details. */
export async function fetchMemberMonth(tenantId: string, member: any, year: number, month: number) {
  const first = dateStr(new Date(year, month, 1));
  const last = dateStr(new Date(year, month + 1, 0));
  const [details, attendance, leaves, wfh, holidays, outlets] = await Promise.all([
    supabase.from('profiles').select('id, phone, email, join_date').eq('id', member.id).maybeSingle(),
    supabase.from('attendance').select('profile_id, date, status, total_hours, punches(punch_time, punch_type)')
      .eq('profile_id', member.id).gte('date', first).lte('date', last).order('date'),
    supabase.from('leave_requests')
      .select('id, profile_id, leave_type, start_date, end_date, status, current_stage, half_day, half_day_from, half_day_to, reason')
      .eq('profile_id', member.id).in('status', ['Pending', 'Approved'])
      .lte('start_date', last).gte('end_date', first),
    supabase.from('wfh_requests').select('profile_id, from_date, to_date')
      .eq('profile_id', member.id).eq('status', 'Approved').lte('from_date', last).gte('to_date', first),
    supabase.from('holidays').select('*').eq('tenant_id', tenantId).gte('date', first).lte('date', last),
    member.outlet_id
      ? supabase.from('outlets').select('id, name, weekly_off_days, holidays_enabled').eq('id', member.outlet_id)
      : Promise.resolve({ data: [], error: null } as any),
  ]);
  return {
    details: details.data as any,
    attendance: (attendance.data || []) as any[],
    leaves: (leaves.data || []) as any[],
    wfh: (wfh.data || []) as any[],
    holidays: (holidays.data || []) as any[],
    outlets: (outlets.data || []) as any[],
    error: attendance.error || leaves.error || wfh.error || holidays.error,
  };
}

/** Earliest clock-in and latest clock-out on an attendance row, as 'HH:MM:SS' strings. */
export function firstInLastOut(att: any): { inAt: string | null; outAt: string | null } {
  const punches = [...(att?.punches || [])].sort((a: any, b: any) => String(a.punch_time).localeCompare(String(b.punch_time)));
  const ins = punches.filter((p: any) => p.punch_type === 'in');
  const outs = punches.filter((p: any) => p.punch_type === 'out');
  return { inAt: ins[0]?.punch_time || null, outAt: outs[outs.length - 1]?.punch_time || null };
}
