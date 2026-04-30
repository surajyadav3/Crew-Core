import { supabase } from '@/lib/supabase';

export async function fetchMyAdvanceBalance(profileId: string) {
  const { data, error } = await supabase
    .from('advances')
    .select('balance')
    .eq('profile_id', profileId)
    .eq('status', 'Active');
  const total = (data || []).reduce((sum, a) => sum + (a.balance || 0), 0);
  return { total, error };
}
