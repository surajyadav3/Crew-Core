import { supabase } from '@/lib/supabase';

export async function listAnnouncements(tenantId: string) {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function createAnnouncement(tenantId: string, createdBy: string, title: string, message: string) {
  const { data, error } = await supabase
    .from('announcements')
    .insert([{ tenant_id: tenantId, created_by: createdBy, title, message }])
    .select()
    .single();
  return { data, error };
}
