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

/**
 * The live comp-off counter. The cached profile from sign-in goes stale as
 * soon as HR adds days or a weekly-off punch credits one, so screens that show
 * the balance read it fresh.
 */
export async function fetchMyCompOffBalance(profileId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('comp_off_balance')
    .eq('id', profileId)
    .maybeSingle();
  return { balance: data ? Number(data.comp_off_balance || 0) : null, error };
}
