import { supabase } from '@/lib/supabase';
import { isRaniwalaTenant } from '@/lib/helpers';
import { isHrRole, type ApprovalKind } from '@/lib/approvals';
import { incrementManagerCount } from './requestQuotaService';
import { notifyProfiles } from './notificationService';

/**
 * The approver side of every request type — the same reads and writes as the
 * website's LeavesPage / PunchApprovalsPage / RegularizeAttendancePage /
 * WFHRequestsPage / SpecialRequestsPage / ExpenseClaimsPage /
 * TravelRequestsPage (src/services/*.js in the web repo), so a decision made
 * here lands exactly like one made on the website. RLS scopes every list to
 * the caller's team at Raniwala (my_team_ids) and the DB triggers enforce who
 * may decide what — the gates below only decide which buttons are shown.
 */

export type StatusFilter = 'Pending' | 'Approved' | 'Rejected' | 'All';

// Decided requests are history — keep the list (and the request) small.
const HISTORY_LIMIT = 60;

function byStatus(query: any, status: StatusFilter, column = 'status') {
  if (status === 'All') return query.limit(HISTORY_LIMIT);
  query = query.eq(column, status);
  return status === 'Pending' ? query : query.limit(HISTORY_LIMIT);
}

// ── Leave ────────────────────────────────────────────────────────────────────

const LEAVE_SELECT = `
  *,
  profile:profile_directory!leave_requests_profile_id_fkey(first_name, middle_name, last_name, department, designation, employee_id),
  approver:profile_directory!leave_requests_approved_by_fkey(first_name, middle_name, last_name),
  manager_decider:profile_directory!leave_requests_manager_decided_by_fkey(first_name, middle_name, last_name),
  hr_decider:profile_directory!leave_requests_hr_decided_by_fkey(first_name, middle_name, last_name),
  hod_decider:profile_directory!leave_requests_hod_decided_by_fkey(first_name, middle_name, last_name),
  management_decider:profile_directory!leave_requests_management_decided_by_fkey(first_name, middle_name, last_name),
  stage_manager:profile_directory!leave_requests_manager_id_fkey(first_name, middle_name, last_name),
  stage_hod:profile_directory!leave_requests_hod_id_fkey(first_name, middle_name, last_name)
`;

export async function listTeamLeaves(tenantId: string, meId: string, status: StatusFilter) {
  const query = supabase
    .from('leave_requests')
    .select(LEAVE_SELECT)
    .eq('tenant_id', tenantId)
    .neq('profile_id', meId)
    .order('created_at', { ascending: false });
  const { data, error } = await byStatus(query, status);
  return { data: (data || []) as any[], error };
}

/** A Raniwala multi-stage row (manager_status is only ever set by the DB trigger for those). */
export const isMultiStageLeave = (req: any, tenant: any) => isRaniwalaTenant(tenant) && req?.manager_status != null;

/**
 * Which Raniwala stage (if any) `profile` may decide on `req` right now —
 * mirrors enforce_leave_dual_approval() and the web's myLeaveStage().
 */
export function myLeaveStage(req: any, profile: any): 'manager' | 'hod' | 'hr' | 'management' | null {
  if (!req?.current_stage || req.status !== 'Pending' || !profile) return null;
  const { role, id } = profile;
  // Manager / HOD stages go by who is assigned, not current role.
  if (req.current_stage === 'manager' && req.manager_id === id) return 'manager';
  if (req.current_stage === 'hod' && req.hod_id === id) return 'hod';
  // HR can decide at any stage; it's final and skips whoever hasn't acted.
  if (isHrRole(role)) return 'hr';
  if (req.current_stage === 'management' && role === 'management') return 'management';
  return null;
}

/** Can `profile` approve / reject this leave right now? Same gate as the web's per-row buttons. */
export function canDecideLeave(req: any, profile: any, tenant: any) {
  if (isMultiStageLeave(req, tenant)) return !!myLeaveStage(req, profile);
  return req.status === 'Pending' && (profile?.role !== 'manager' || req.required_approver_role === 'manager');
}

const leaveDays = (leave: any) => {
  if (leave?.half_day) return 0.5;
  const [sy, sm, sd] = String(leave.start_date).split('-').map(Number);
  const [ey, em, ed] = String(leave.end_date).split('-').map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1;
};

/**
 * On a final Approved / Rejected outcome: Comp Off balance, the leave-ledger
 * deduction and the employee's notification — exactly the web's
 * runLeaveApprovalOutcome().
 */
async function runLeaveApprovalOutcome(leave: any, id: string, approverId: string, status: string) {
  if (status === 'Approved') {
    if (leave?.leave_type === 'Comp Off') {
      await supabase.rpc('adjust_comp_off_balance', { p_profile_id: leave.profile_id, p_delta: -leaveDays(leave) });
    }
    const { error: ledgerErr } = await supabase.rpc('record_leave_deduction', { p_leave_request_id: id });
    if (ledgerErr) console.error('record_leave_deduction failed:', ledgerErr.message);
  }
  if (leave?.tenant_id && leave?.profile_id) {
    await notifyProfiles(leave.tenant_id, [leave.profile_id], {
      type: `leave_request_${status.toLowerCase()}`,
      title: `Leave request ${status}`,
      body: `Your ${leave.leave_type || ''} leave request was ${status.toLowerCase()}.`,
      linkKey: 'leave_requests',
      actorId: approverId,
      relatedId: id,
    });
  }
}

/** Single-stage leave (every tenant except Raniwala's multi-stage rows). */
async function updateLeaveStatus(id: string, status: string, approverId: string, approverRole: string) {
  const { data: leave } = await supabase
    .from('leave_requests')
    .select('leave_type, start_date, end_date, half_day, profile_id, tenant_id')
    .eq('id', id)
    .single();

  const { data: updated, error } = await supabase
    .from('leave_requests')
    .update({ status, approved_by: approverId })
    .eq('id', id)
    .eq('status', 'Pending')
    .select('id');
  if (error) return { error };
  if (!updated?.length) return { error: new Error('This request has already been reviewed.') };

  if (status === 'Approved' && approverRole === 'manager' && leave?.tenant_id && leave?.profile_id) {
    await incrementManagerCount(leave.tenant_id, leave.profile_id);
  }
  await runLeaveApprovalOutcome(leave, id, approverId, status);
  return { error: null };
}

const STAGE_COLUMNS: Record<string, { status: string; by: string; at: string }> = {
  manager: { status: 'manager_status', by: 'manager_decided_by', at: 'manager_decided_at' },
  hod: { status: 'hod_status', by: 'hod_decided_by', at: 'hod_decided_at' },
  hr: { status: 'hr_status', by: 'hr_decided_by', at: 'hr_decided_at' },
  management: { status: 'management_status', by: 'management_decided_by', at: 'management_decided_at' },
};

/** Raniwala: one approver's decision on their own stage; the DB moves the request on. */
async function decideLeaveStage(id: string, stage: string, decision: string, approverId: string) {
  const cols = STAGE_COLUMNS[stage];
  if (!cols) return { error: new Error('Unknown approval stage') };

  const { data: updated, error } = await supabase
    .from('leave_requests')
    .update({ [cols.status]: decision, [cols.by]: approverId, [cols.at]: new Date().toISOString() })
    .eq('id', id)
    // HR may decide at any stage, so only require the request to be open.
    .eq(stage === 'hr' ? 'status' : 'current_stage', stage === 'hr' ? 'Pending' : stage)
    .select('id, status, profile_id, tenant_id, leave_type, start_date, end_date, half_day')
    .maybeSingle();
  if (error) return { error };
  if (!updated) return { error: new Error('This request has already been reviewed.') };

  if (updated.status === 'Approved' || updated.status === 'Rejected') {
    await runLeaveApprovalOutcome(updated, id, approverId, updated.status);
  }
  return { error: null };
}

export async function decideLeave(req: any, approve: boolean, profile: any, tenant: any) {
  const decision = approve ? 'Approved' : 'Rejected';
  if (isMultiStageLeave(req, tenant)) {
    const stage = myLeaveStage(req, profile);
    if (!stage) return { error: new Error('This request is waiting on someone else.') };
    return decideLeaveStage(req.id, stage, decision, profile.id);
  }
  return updateLeaveStatus(req.id, decision, profile.id, profile.role);
}

// ── Punch approvals (Raniwala app / web punches) ─────────────────────────────

/** Rows from list_punch_approvals — scoped server-side to approver / manager / HOD / HR. */
export async function listPunchApprovals(status: StatusFilter) {
  const { data, error } = await supabase.rpc('list_punch_approvals', { p_status: status.toLowerCase(), p_since: null });
  return { data: (data || []) as any[], error };
}

/** One card per employee per day, so a clock-in and clock-out are reviewed together. */
export function groupPunchDays(punches: any[]) {
  const byDay = new Map<string, any>();
  punches.forEach((p) => {
    if (!byDay.has(p.attendance_id)) byDay.set(p.attendance_id, { ...p, id: p.attendance_id, punches: [] });
    byDay.get(p.attendance_id).punches.push(p);
  });
  return [...byDay.values()].map((d) => ({
    ...d,
    punches: d.punches.sort((a: any, b: any) => String(a.punch_time).localeCompare(String(b.punch_time))),
    pendingIds: d.punches.filter((p: any) => p.approval_status === 'pending').map((p: any) => p.punch_id),
  }));
}

export async function reviewPunches(punchIds: string[], approve: boolean) {
  const { data, error } = await supabase.rpc('review_punches', { p_punch_ids: punchIds, p_approve: approve });
  return { count: (data as number) || 0, error };
}

// ── Regularize ───────────────────────────────────────────────────────────────

export async function listTeamRegularize(tenantId: string, meId: string, status: StatusFilter) {
  const query = supabase
    .from('regularize_requests')
    .select(`
      *,
      profile:profile_directory!regularize_requests_profile_id_fkey(first_name, middle_name, last_name, department, designation, employee_id),
      reviewer:profile_directory!regularize_requests_reviewed_by_fkey(first_name, middle_name, last_name, role)
    `)
    .eq('tenant_id', tenantId)
    .neq('profile_id', meId)
    .order('created_at', { ascending: false });
  const { data, error } = await byStatus(query, status);
  return { data: (data || []) as any[], error };
}

/** Managers only act on manager-tier rows; HOD / management / HR on any (RLS scopes the rows). */
export const canDecideTiered = (req: any, profile: any) =>
  req.status === 'Pending' && (profile?.role !== 'manager' || req.required_approver_role === 'manager');

export async function decideRegularize(req: any, approve: boolean, profile: any) {
  const status = approve ? 'Approved' : 'Rejected';
  // Claim the request only while still Pending — flipping it to Approved fires
  // trg_apply_approved_regularize_request, which writes the corrected day.
  const { data: claimed, error } = await supabase
    .from('regularize_requests')
    .update({ status, reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
    .eq('id', req.id)
    .eq('status', 'Pending')
    .select('id');
  if (error) return { error };
  if (!claimed?.length) return { error: new Error('This request has already been reviewed.') };

  if (approve && profile.role === 'manager') await incrementManagerCount(req.tenant_id, req.profile_id);

  await notifyProfiles(req.tenant_id, [req.profile_id], {
    type: `regularize_request_${status.toLowerCase()}`,
    title: `Regularize request ${status.toLowerCase()}`,
    body: `Your attendance correction for ${req.date} was ${status.toLowerCase()}.`,
    linkKey: 'regularize_attendance',
    actorId: profile.id,
    relatedId: req.id,
  });
  return { error: null };
}

// ── Work from home ───────────────────────────────────────────────────────────

export async function listTeamWfh(tenantId: string, meId: string, status: StatusFilter) {
  const query = supabase
    .from('wfh_requests')
    .select(`
      *,
      profile:profile_directory!wfh_requests_profile_id_fkey(first_name, middle_name, last_name, department, designation, employee_id),
      reviewer:profile_directory!wfh_requests_reviewed_by_fkey(first_name, middle_name, last_name, role)
    `)
    .eq('tenant_id', tenantId)
    .neq('profile_id', meId)
    .order('created_at', { ascending: false });
  const { data, error } = await byStatus(query, status);
  return { data: (data || []) as any[], error };
}

export async function decideWfh(req: any, approve: boolean, profile: any) {
  const status = approve ? 'Approved' : 'Rejected';
  const { data: updated, error } = await supabase
    .from('wfh_requests')
    .update({ status, reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
    .eq('id', req.id)
    .eq('status', 'Pending')
    .select('id');
  if (error) return { error };
  if (!updated?.length) return { error: new Error('This request has already been reviewed.') };

  await notifyProfiles(req.tenant_id, [req.profile_id], {
    type: `wfh_request_${status.toLowerCase()}`,
    title: `WFH request ${status.toLowerCase()}`,
    body: `Your WFH request (${req.from_date} – ${req.to_date}) was ${status.toLowerCase()}.`,
    linkKey: 'wfh_requests',
    actorId: profile.id,
    relatedId: req.id,
  });
  return { error: null };
}

// ── Special requests (not Raniwala) ──────────────────────────────────────────

export async function listTeamSpecial(tenantId: string, meId: string, status: StatusFilter) {
  const query = supabase
    .from('special_requests')
    .select(`
      *,
      profile:profile_directory!special_requests_profile_id_fkey(first_name, middle_name, last_name, department, designation, employee_id),
      approver:profile_directory!special_requests_approved_by_fkey(first_name, middle_name, last_name)
    `)
    .eq('tenant_id', tenantId)
    .neq('profile_id', meId)
    .order('created_at', { ascending: false });
  const { data, error } = await byStatus(query, status);
  return { data: (data || []) as any[], error };
}

export async function decideSpecial(req: any, approve: boolean, profile: any) {
  const status = approve ? 'Approved' : 'Rejected';
  const { data: updated, error } = await supabase
    .from('special_requests')
    .update({ status, approved_by: profile.id })
    .eq('id', req.id)
    .eq('status', 'Pending')
    .select('id');
  if (error) return { error };
  if (!updated?.length) return { error: new Error('This request has already been reviewed.') };

  if (approve && profile.role === 'manager') await incrementManagerCount(req.tenant_id, req.profile_id);

  await notifyProfiles(req.tenant_id, [req.profile_id], {
    type: `special_request_${status.toLowerCase()}`,
    title: `Special request ${status}`,
    body: `Your special request was ${status.toLowerCase()}.`,
    linkKey: 'special_requests',
    actorId: profile.id,
    relatedId: req.id,
  });
  return { error: null };
}

// ── Expense claims (manager / HR) ────────────────────────────────────────────

export async function listTeamExpenses(tenantId: string, meId: string, status: StatusFilter) {
  const query = supabase
    .from('expense_claims')
    .select('*, items:expense_claim_items(*), profile:profile_directory!expense_claims_profile_id_fkey(first_name, middle_name, last_name, department, designation, employee_id)')
    .eq('tenant_id', tenantId)
    .neq('profile_id', meId)
    .order('created_at', { ascending: false });
  const { data, error } = await byStatus(query, status);
  return { data: (data || []) as any[], error };
}

/** A one-hour link to an expense receipt in the private expense-receipts bucket. */
export async function getReceiptUrl(path: string) {
  const { data, error } = await supabase.storage.from('expense-receipts').createSignedUrl(path, 3600);
  return { url: data?.signedUrl || null, error };
}

/** Approving nets the claim against its advance or adds a reimbursement to this month's pay items (approve_expense_claim). */
export async function decideExpense(req: any, approve: boolean, profile: any) {
  const now = new Date();
  const { error } = approve
    ? await supabase.rpc('approve_expense_claim', { p_claim_id: req.id, p_month: now.getMonth() + 1, p_year: now.getFullYear() })
    : await supabase.from('expense_claims').update({ status: 'Rejected' }).eq('id', req.id).eq('status', 'Pending');
  if (error) return { error };

  await notifyProfiles(req.tenant_id, [req.profile_id], {
    type: approve ? 'expense_claim_approved' : 'expense_claim_rejected',
    title: approve ? 'Expense claim approved' : 'Expense claim rejected',
    body: approve ? 'Your expense claim was approved.' : 'Your expense claim was rejected.',
    linkKey: 'expense_claims',
    actorId: profile.id,
    relatedId: req.id,
  });
  return { error: null };
}

// ── Travel requests (manager / HR) ───────────────────────────────────────────

export async function listTeamTravel(tenantId: string, meId: string, status: StatusFilter) {
  const query = supabase
    .from('travel_requests')
    .select('*, legs:travel_legs(*), profile:profile_directory!travel_requests_profile_id_fkey(first_name, middle_name, last_name, department, designation, employee_id)')
    .eq('tenant_id', tenantId)
    .neq('profile_id', meId)
    .order('created_at', { ascending: false });
  const { data, error } = await byStatus(query, status);
  return { data: (data || []) as any[], error };
}

export async function decideTravel(req: any, approve: boolean, profile: any) {
  const status = approve ? 'Approved' : 'Rejected';
  const { data: updated, error } = await supabase
    .from('travel_requests')
    .update({ status, approved_by: profile.id })
    .eq('id', req.id)
    .eq('status', 'Pending')
    .select('id');
  if (error) return { error };
  if (!updated?.length) return { error: new Error('This request has already been reviewed.') };

  await notifyProfiles(req.tenant_id, [req.profile_id], {
    type: `travel_request_${status.toLowerCase()}`,
    title: `Travel request ${status}`,
    body: `Your travel request was ${status.toLowerCase()}.`,
    linkKey: 'travel_requests',
    actorId: profile.id,
    relatedId: req.id,
  });
  return { error: null };
}

// ── Pending counts (Team tab badge, Home card, inbox tiles) ──────────────────

export type PendingCounts = Partial<Record<ApprovalKind, number>>;

/**
 * How many requests are waiting on this person, per type. Head-only counts
 * (no rows), except punches, whose RPC has no count form.
 */
export async function fetchPendingCounts(profile: any, tenant: any, kinds: ApprovalKind[]): Promise<PendingCounts> {
  const me = profile.id;
  const role = profile.role;
  const hr = isHrRole(role);
  const raniwala = isRaniwalaTenant(tenant);

  const head = (table: string) => supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .neq('profile_id', me)
    .eq('status', 'Pending');

  const counters: Record<ApprovalKind, () => Promise<number>> = {
    leave: async () => {
      let q = head('leave_requests');
      if (raniwala && !hr) {
        // Only the stage waiting on me: my manager / HOD assignment, or the Management stage.
        const stages = [`and(current_stage.eq.manager,manager_id.eq.${me})`, `and(current_stage.eq.hod,hod_id.eq.${me})`];
        if (role === 'management') stages.push('current_stage.eq.management');
        q = q.or(stages.join(','));
      } else if (role === 'manager') {
        q = q.eq('required_approver_role', 'manager');
      }
      const { count } = await q;
      return count || 0;
    },
    punch: async () => {
      const { data } = await listPunchApprovals('Pending');
      return new Set(data.filter((p) => p.profile_id !== me).map((p) => p.attendance_id)).size;
    },
    regularize: async () => {
      let q = head('regularize_requests');
      if (role === 'manager') q = q.eq('required_approver_role', 'manager');
      const { count } = await q;
      return count || 0;
    },
    wfh: async () => (await head('wfh_requests')).count || 0,
    special: async () => {
      let q = head('special_requests');
      if (role === 'manager') q = q.eq('required_approver_role', 'manager');
      const { count } = await q;
      return count || 0;
    },
    expense: async () => (await head('expense_claims')).count || 0,
    travel: async () => (await head('travel_requests')).count || 0,
    verification: async () => (await head('profile_verification_requests')).count || 0,
  };

  const entries = await Promise.all(kinds.map(async (k) => {
    try { return [k, await counters[k]()] as const; } catch { return [k, 0] as const; }
  }));
  return Object.fromEntries(entries);
}
