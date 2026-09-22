import { supabase } from '@/lib/supabase';

/** An employee's own onboarding process (most recent), with its tasks. Read+act only — starting a process is admin/web-only. */
export async function fetchMyProcess(profileId: string) {
  const { data, error } = await supabase
    .from('onboarding_processes')
    .select('*, tasks:onboarding_process_tasks(*)')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { data: data || null, error };
}

export async function updateTaskStatus(id: string, status: string) {
  const { error } = await supabase.from('onboarding_process_tasks').update({
    status, completed_at: status === 'Done' ? new Date().toISOString() : null,
  }).eq('id', id);
  return { error };
}
