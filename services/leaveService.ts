import { supabase } from '@/lib/supabase';
import { getOrCreateQuota, determineApproverRole } from './requestQuotaService';
import { notifyProfiles, notifyRoles, getRequesterLabel } from './notificationService';
import type { HalfDayWindows } from '@/lib/halfDayLeave';

export async function listMyLeaveRequests(profileId: string) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('profile_id', profileId)
    .order('start_date', { ascending: false });
  return { data: data || [], error };
}

/**
 * The signed-in employee's shift split in two, for a half-day leave (web repo
 * migration 20261013_2): { shift_name, shift_start, shift_end, first_half, second_half }.
 */
export async function fetchMyHalfDayWindows() {
  const { data, error } = await supabase.rpc('my_leave_half_day_windows');
  return { data: (data || null) as HalfDayWindows | null, error };
}

export async function checkProbationStatus(profileId: string) {
  const { data: prof } = await supabase
    .from('profiles')
    .select('join_date, probation_months, probation_earned_leaves')
    .eq('id', profileId)
    .single();

  if (!prof || !prof.probation_months || !prof.join_date) {
    return { inProbation: false, endsOn: null as string | null, earnedLeaves: 0 };
  }

  const [y, m, d] = prof.join_date.split('-').map(Number);
  const joinDate = new Date(y, m - 1, d);
  const endsOn = new Date(joinDate);
  endsOn.setMonth(endsOn.getMonth() + prof.probation_months);
  const inProbation = new Date() < endsOn;

  return {
    inProbation,
    endsOn: endsOn.toISOString().split('T')[0],
    earnedLeaves: prof.probation_earned_leaves || 0,
  };
}

export async function requestLeave(payload: {
  leave_type: string;
  start_date: string;
  end_date: string;
  // null = full day(s); 'first_half' / 'second_half' = half of one date.
  half_day?: string | null;
  reason: string;
  profile_id: string;
  tenant_id: string;
  status: string;
}) {
  const { tenant_id, profile_id } = payload;

  const quota = await getOrCreateQuota(tenant_id, profile_id);
  const tier = determineApproverRole(quota);

  const finalPayload = {
    ...payload,
    status: tier === 'self' ? 'Approved' : 'Pending',
    required_approver_role: tier,
    approval_level: tier === 'self' ? 'self' : null,
  };

  // No client-side quota increment here on purpose — the server's
  // enforce_leave_request_tier trigger (supabase/hardening_migration.sql)
  // already bumps self_approved_count atomically inside the insert below.
  // Calling incrementSelfCount here too would double-count every leave
  // request against the monthly self-approval limit.
  //
  // For Raniwala rows, enforce_leave_request_approval_tier (see
  // supabase/migrations/20260921_2_raniwala_leave_manager_hod_approval.sql
  // in the web repo) discards status/required_approver_role/manager_id/
  // manager_status/hr_status/requires_hr_approval computed above and
  // re-derives them from the employee's actual reporting manager + leave
  // duration — this insert's payload guess is only ever used for non-Raniwala
  // tenants. Re-selecting after insert (rather than trusting `tier` above)
  // mirrors src/services/leaveService.js's requestLeave() exactly, for the
  // same reason: a stale client guess must never drive the notification or
  // the post-submit message shown to the employee.
  const { data: inserted, error } = await supabase
    .from('leave_requests')
    .insert([finalPayload])
    .select('id, required_approver_role, manager_id, manager_status, hr_status, requires_hr_approval')
    .single();

  const actualTier = inserted?.required_approver_role || tier;

  // Raniwala multi-stage rows (manager_status set): the DB notifies whoever's
  // stage is up (trg_notify_leave_stage, web repo 20260926_1) — the manager,
  // or the HOD when the HOD is also the manager, or HR when neither is on
  // file. Same as the website's requestLeave; notifying here too sent a
  // duplicate, and told all of HR "no reporting manager" when the first
  // approver was actually an HOD.
  if (!error && inserted?.id && !inserted.manager_status) {
    const requester = await getRequesterLabel(profile_id);
    if (actualTier === 'self') {
      await notifyProfiles(tenant_id, [profile_id], {
        type: 'leave_request_auto_approved',
        title: 'Leave request auto-approved',
        body: `Your ${payload.leave_type || ''} leave request was automatically approved.`,
        linkKey: 'leave_requests',
        relatedId: inserted.id,
      });
      // HR still gets a heads-up even on a self-approved request — nothing
      // for them to act on, but they should never be left unaware.
      await notifyRoles(tenant_id, ['admin'], {
        type: 'leave_request_auto_approved',
        title: 'Leave request auto-approved',
        body: `${requester} submitted a ${payload.leave_type || ''} leave request — auto-approved, no action needed.`,
        linkKey: 'leave_requests',
        actorId: profile_id,
        relatedId: inserted.id,
      }, profile_id);
    } else {
      // Every other tenant's existing self/manager/admin quota routing.
      await notifyRoles(tenant_id, [...new Set([actualTier, 'admin'])], {
        type: 'leave_request_submitted',
        title: 'New leave request',
        body: `${requester} submitted a new ${payload.leave_type || ''} leave request — needs your review.`,
        linkKey: 'leave_requests',
        actorId: profile_id,
        relatedId: inserted.id,
      }, profile_id);
    }
  }

  return { error, tier: actualTier };
}
