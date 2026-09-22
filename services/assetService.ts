import { supabase } from '@/lib/supabase';

/** An employee's own asset assignment history, current and past. Read-only — assigning/returning assets is admin/web-only. */
export async function listMyAssignments(profileId: string) {
  const { data, error } = await supabase
    .from('asset_assignments')
    .select('*, asset:assets(name, category, serial_number)')
    .eq('profile_id', profileId)
    .order('assigned_at', { ascending: false });
  return { data: data || [], error };
}
