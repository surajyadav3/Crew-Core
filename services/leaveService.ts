import { supabase } from '@/lib/supabase';

export async function listMyLeaveRequests(profileId: string) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('profile_id', profileId)
    .order('start_date', { ascending: false });
  return { data: data || [], error };
}

export async function requestLeave(payload: {
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  profile_id: string;
  tenant_id: string;
  status: string;
}) {
  const { error } = await supabase.from('leave_requests').insert([payload]);
  return { error };
}
