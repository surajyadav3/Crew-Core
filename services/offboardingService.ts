import { supabase } from '@/lib/supabase';

/** An employee's own offboarding process (most recent), with its tasks. Read+act only — starting a process is admin/web-only. */
export async function fetchMyProcess(profileId: string) {
  const { data, error } = await supabase
    .from('offboarding_processes')
    .select('*, tasks:offboarding_process_tasks(*)')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { data: data || null, error };
}

export async function updateTaskStatus(id: string, status: string) {
  const { error } = await supabase.from('offboarding_process_tasks').update({
    status, completed_at: status === 'Done' ? new Date().toISOString() : null,
  }).eq('id', id);
  return { error };
}
