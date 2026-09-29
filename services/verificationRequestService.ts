import { supabase } from '@/lib/supabase';
import { notifyRoles, notifyProfiles, getRequesterLabel } from './notificationService';

export type FieldGroup = 'bank' | 'pan' | 'aadhar';

const FIELD_GROUP_LABEL: Record<FieldGroup, string> = { bank: 'Bank Details', pan: 'PAN', aadhar: 'Aadhar' };

/** Employee: their own verification requests, newest first. */
export async function listMyVerificationRequests(profileId: string) {
  const { data, error } = await supabase
    .from('profile_verification_requests')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/**
 * Stages a Bank/PAN/Aadhar change for HR/manager approval — never writes to
 * `profiles` directly. Only one live Pending request per field_group is
 * allowed (enforced by a DB unique index), so a second edit while one is
 * still pending is rejected with a clear error rather than silently queued.
 */
export async function submitVerificationRequest(opts: {
  tenantId: string; profileId: string; fieldGroup: FieldGroup;
  oldValue: Record<string, string>; newValue: Record<string, string>;
}) {
  const { tenantId, profileId, fieldGroup, oldValue, newValue } = opts;
  const { data, error } = await supabase
    .from('profile_verification_requests')
    .insert([{ tenant_id: tenantId, profile_id: profileId, field_group: fieldGroup, old_value: oldValue, new_value: newValue }])
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return { data: null, error: new Error(`You already have a pending ${FIELD_GROUP_LABEL[fieldGroup]} request awaiting review.`) };
    }
    return { data: null, error };
  }

  if (data?.id) {
    const requester = await getRequesterLabel(profileId);
    const opts = {
      type: 'verification_request_submitted',
      title: `New ${FIELD_GROUP_LABEL[fieldGroup]} verification request`,
      body: `${requester || 'An employee'} updated their ${FIELD_GROUP_LABEL[fieldGroup]} — needs your review.`,
      linkKey: 'verification_requests',
      actorId: profileId,
      relatedId: data.id,
    };
    // HR (admin) plus this employee's own reporting manager — the only people
    // who can approve it (review_verification_request) — not every manager.
    await notifyRoles(tenantId, ['admin'], opts, profileId);
    const { data: me } = await supabase.from('profile_directory').select('manager_id').eq('id', profileId).maybeSingle();
    if (me?.manager_id) await notifyProfiles(tenantId, [me.manager_id], opts);
  }
  return { data, error: null };
}

export async function cancelVerificationRequest(id: string) {
  const { error } = await supabase.from('profile_verification_requests').delete().eq('id', id).eq('status', 'Pending');
  return { error };
}

/**
 * Reviewer (HR or reporting manager): verification requests from other people
 * that this user may review. RLS (20260923_5_profile_verification_review.sql)
 * already limits rows to the caller's own reports (or the whole tenant for HR).
 */
export async function listTeamVerificationRequests(myProfileId: string) {
  const { data, error } = await supabase
    .from('profile_verification_requests')
    .select('*, profile:profile_directory!profile_verification_requests_profile_id_fkey(first_name, middle_name, last_name, department, designation, outlet_location)')
    .neq('profile_id', myProfileId)
    .order('created_at', { ascending: false })
    .limit(100);
  return { data: data || [], error };
}

/** Approve/reject atomically — applies the new values and stamps Verified on approval (server-side). */
export async function reviewVerificationRequest(request: any, approve: boolean, reviewerId: string) {
  const { error } = await supabase.rpc('review_verification_request', { p_request_id: request.id, p_approve: approve });
  if (error) return { error: new Error(error.message) };
  const label = FIELD_GROUP_LABEL[request.field_group as FieldGroup];
  await notifyProfiles(request.tenant_id, [request.profile_id], approve ? {
    type: 'verification_request_approved',
    title: `${label} verified`,
    body: `Your updated ${label} was approved and is now verified.`,
    linkKey: 'verification_requests', actorId: reviewerId, relatedId: request.id,
  } : {
    type: 'verification_request_rejected',
    title: `${label} change rejected`,
    body: `Your requested ${label} change was rejected. Your previous details are unchanged.`,
    linkKey: 'verification_requests', actorId: reviewerId, relatedId: request.id,
  });
  return { error: null };
}

export { FIELD_GROUP_LABEL };
