import { supabase } from '@/lib/supabase';

const SELECT = `
  *,
  manager:profile_directory!pips_manager_id_fkey(first_name, middle_name, last_name),
  pip_goals(*)
`;

/** My own active (or most recent) Performance Improvement Plan, if any. */
export async function getMyActivePip(tenantId: string, profileId: string) {
  const { data, error } = await supabase
    .from('pips')
    .select(SELECT)
    .eq('tenant_id', tenantId)
    .eq('profile_id', profileId)
    .eq('status', 'In Process')
    .maybeSingle();
  return { data, error };
}

export async function listPipCheckins(pipId: string) {
  const { data, error } = await supabase
    .from('pip_checkins')
    .select('*, author:profile_directory!pip_checkins_author_id_fkey(first_name, middle_name, last_name)')
    .eq('pip_id', pipId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}
