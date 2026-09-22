import { supabase } from '@/lib/supabase';

const SELECT = `
  *,
  from_profile:profiles!feedback_from_profile_id_fkey(first_name, middle_name, last_name),
  to_profile:profiles!feedback_to_profile_id_fkey(first_name, middle_name, last_name),
  requested_from_profile:profiles!feedback_requested_from_fkey(first_name, middle_name, last_name)
`;

/** Feedback received about me (completed, not pending requests). */
export async function listReceivedFeedback(tenantId: string, profileId: string) {
  const { data, error } = await supabase
    .from('feedback')
    .select(SELECT)
    .eq('tenant_id', tenantId)
    .eq('to_profile_id', profileId)
    .eq('status', 'Completed')
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Feedback I've given to others. */
export async function listGivenFeedback(tenantId: string, profileId: string) {
  const { data, error } = await supabase
    .from('feedback')
    .select(SELECT)
    .eq('tenant_id', tenantId)
    .eq('from_profile_id', profileId)
    .eq('status', 'Completed')
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Pending feedback requests directed at me, awaiting my response. */
export async function listPendingRequests(tenantId: string, profileId: string) {
  const { data, error } = await supabase
    .from('feedback')
    .select(SELECT)
    .eq('tenant_id', tenantId)
    .eq('requested_from', profileId)
    .eq('status', 'Pending')
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Colleagues in my tenant I can give/request feedback to or from. */
export async function listColleagues(tenantId: string, excludeProfileId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, first_name, middle_name, last_name, role')
    .eq('tenant_id', tenantId)
    .eq('status', 'Active')
    .in('role', ['employee', 'admin', 'manager'])
    .neq('id', excludeProfileId)
    .order('first_name');
  return { data: data || [], error };
}

/** Give direct praise or feedback to someone. */
export async function giveFeedback({ tenantId, fromProfileId, toProfileId, type, message, visibility }: {
  tenantId: string; fromProfileId: string; toProfileId: string; type: string; message: string; visibility: string;
}) {
  const { error } = await supabase
    .from('feedback')
    .insert([{
      tenant_id: tenantId,
      created_by: fromProfileId,
      from_profile_id: fromProfileId,
      to_profile_id: toProfileId,
      type: type || 'feedback',
      message,
      visibility: visibility || 'private',
      status: 'Completed',
    }]);
  return { error };
}

/** Request feedback about myself from a colleague. */
export async function requestFeedback({ tenantId, createdBy, requestedFrom }: {
  tenantId: string; createdBy: string; requestedFrom: string;
}) {
  const { error } = await supabase
    .from('feedback')
    .insert([{
      tenant_id: tenantId,
      created_by: createdBy,
      to_profile_id: createdBy,
      requested_from: requestedFrom,
      type: 'request',
      status: 'Pending',
    }]);
  return { error };
}

/** Fulfill a pending feedback request directed at me. */
export async function respondToFeedbackRequest(id: string, { fromProfileId, message }: { fromProfileId: string; message: string }) {
  const { error } = await supabase
    .from('feedback')
    .update({ from_profile_id: fromProfileId, message, status: 'Completed' })
    .eq('id', id)
    .eq('status', 'Pending');
  return { error };
}
