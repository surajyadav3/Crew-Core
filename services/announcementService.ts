import { supabase } from '@/lib/supabase';

/**
 * Newest first. `limit` caps the rows fetched (Home only needs a few). The
 * website writes the text to `body`, older app posts to `message` — read
 * `body || message` when displaying.
 */
export async function listAnnouncements(tenantId: string, limit?: number) {
  let query = supabase
    .from('announcements')
    .select('*, author:profile_directory!announcements_created_by_fkey(first_name, middle_name, last_name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  return { data: data || [], error };
}

/** announcementId -> acknowledged_at for this employee (same table the website's Acknowledge button writes). */
export async function listMyAnnouncementAcks(tenantId: string, profileId: string) {
  const { data, error } = await supabase
    .from('announcement_acknowledgements')
    .select('announcement_id, acknowledged_at')
    .eq('tenant_id', tenantId)
    .eq('profile_id', profileId);
  const map: Record<string, string> = {};
  (data || []).forEach((r: any) => { map[r.announcement_id] = r.acknowledged_at; });
  return { data: map, error };
}

/** Mark an announcement as read. Idempotent — re-acknowledging is a no-op. */
export async function acknowledgeAnnouncement(announcementId: string, profileId: string, tenantId: string) {
  const { error } = await supabase
    .from('announcement_acknowledgements')
    .upsert([{ announcement_id: announcementId, profile_id: profileId, tenant_id: tenantId }], {
      onConflict: 'announcement_id,profile_id',
      ignoreDuplicates: true,
    });
  return { error };
}

export async function createAnnouncement(tenantId: string, createdBy: string, title: string, message: string) {
  const { data, error } = await supabase
    .from('announcements')
    .insert([{ tenant_id: tenantId, created_by: createdBy, title, message }])
    .select()
    .single();
  return { data, error };
}
