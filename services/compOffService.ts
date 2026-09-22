import { supabase } from '@/lib/supabase';

/** An employee's own monthly weekly-off/comp-off settlement history, newest first. */
export async function listMySettlements(profileId: string) {
  const { data, error } = await supabase
    .from('weekly_off_settlements')
    .select('*')
    .eq('profile_id', profileId)
    .order('year', { ascending: false })
    .order('month', { ascending: false });
  return { data: data || [], error };
}
