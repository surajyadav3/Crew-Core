import { supabase } from '@/lib/supabase';
import { notifyRoles } from './notificationService';

export async function listMyWfhRequests(profileId: string) {
  const { data, error } = await supabase
    .from('wfh_requests')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function submitWfhRequest(opts: { tenantId: string; profileId: string; fromDate: string; toDate: string; reason: string }) {
  const { tenantId, profileId, fromDate, toDate, reason } = opts;
  const { data, error } = await supabase
    .from('wfh_requests')
    .insert([{ tenant_id: tenantId, profile_id: profileId, from_date: fromDate, to_date: toDate, reason }])
    .select()
    .single();

  if (!error && data?.id) {
    await notifyRoles(tenantId, ['admin', 'manager'], {
      type: 'wfh_request_submitted',
      title: 'New work-from-home request',
      body: `A new WFH request (${fromDate} – ${toDate}) needs your review.`,
      linkKey: 'wfh_requests',
      actorId: profileId,
      relatedId: data.id,
    }, profileId);
  }

  return { data, error };
}

export async function cancelWfhRequest(id: string) {
  const { error } = await supabase.from('wfh_requests').delete().eq('id', id).eq('status', 'Pending');
  return { error };
}

/** Is this employee on an Approved WFH range covering `dateStr` (YYYY-MM-DD)? Used to bypass geofencing. */
export async function getApprovedWfhForDate(profileId: string, dateStr: string) {
  const { data, error } = await supabase
    .from('wfh_requests')
    .select('id, from_date, to_date')
    .eq('profile_id', profileId)
    .eq('status', 'Approved')
    .lte('from_date', dateStr)
    .gte('to_date', dateStr)
    .maybeSingle();
  return { data, error };
}
