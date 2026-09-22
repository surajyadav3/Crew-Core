import { supabase } from '@/lib/supabase';

/** KRAs visible to me: my own individual KRAs plus any company-wide KRAs. */
export async function listMyKras(tenantId: string, profileId: string) {
  const { data, error } = await supabase
    .from('kras')
    .select('*, kra_kpis(*)')
    .eq('tenant_id', tenantId)
    .or(`profile_id.eq.${profileId},profile_id.is.null`)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function updateKraProgress(id: string, progressPercent: number) {
  const { error } = await supabase.from('kras').update({ progress_percent: progressPercent }).eq('id', id);
  return { error };
}
