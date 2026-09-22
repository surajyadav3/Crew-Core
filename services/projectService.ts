import { supabase } from '@/lib/supabase';

/** Tasks assigned to this employee across every project. */
export async function listMyTasks(profileId: string) {
  const { data, error } = await supabase
    .from('project_tasks')
    .select('*, project:projects(name, status)')
    .eq('assigned_to', profileId)
    .order('due_date', { ascending: true, nullsFirst: false });
  return { data: data || [], error };
}

export async function updateTaskStatus(id: string, status: string) {
  const { error } = await supabase.from('project_tasks').update({ status }).eq('id', id);
  return { error };
}
