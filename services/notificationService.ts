import { supabase } from '@/lib/supabase';

// Birthdays / work anniversaries are website-only — the app never shows them.
const hideCelebrations = (q: any) => q.not('type', 'ilike', 'birthday%').not('type', 'ilike', '%anniversar%');

/** `excludeTypes` filters server-side (e.g. Raniwala's Home drops policy notices), so the limit still returns real updates. */
export async function listMyNotifications(profileId: string, { excludeTypes = [], limit = 50 }: { excludeTypes?: string[]; limit?: number } = {}) {
  let query = hideCelebrations(supabase
    .from('app_notifications')
    .select('*')
    .eq('profile_id', profileId));
  if (excludeTypes.length) query = query.not('type', 'in', `(${excludeTypes.join(',')})`);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit);
  return { data: data || [], error };
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase
    .from('app_notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', id);
  return { error };
}

export async function countUnreadNotifications(profileId: string) {
  const { count, error } = await hideCelebrations(supabase
    .from('app_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('is_read', false));
  return { count: count || 0, error };
}

type NotifyOpts = {
  type: string;
  title: string;
  body?: string;
  linkKey?: string | null;
  actorId?: string | null;
  relatedId?: string | null;
};

/**
 * Bulk-inserts one notification row per recipient. Never throws — a failed
 * notification shouldn't undo or block the action that triggered it, so
 * callers just `await` this as a fire-and-forget last step.
 */
export async function notifyProfiles(tenantId: string, profileIds: (string | null | undefined)[], opts: NotifyOpts) {
  const ids = [...new Set((profileIds || []).filter(Boolean))] as string[];
  if (!tenantId || ids.length === 0 || !opts.type || !opts.title) return;

  const rows = ids.map((profile_id) => ({
    tenant_id: tenantId,
    profile_id,
    actor_id: opts.actorId ?? null,
    type: opts.type,
    title: opts.title,
    body: opts.body ?? '',
    link_key: opts.linkKey ?? null,
    related_id: opts.relatedId ?? null,
  }));

  const { error } = await supabase.from('app_notifications').insert(rows);
  if (error) console.error('notifyProfiles failed:', error.message);
}

/** Notifies every profile in the tenant with one of the given roles. */
export async function notifyRoles(tenantId: string, roles: string[], opts: NotifyOpts, excludeProfileId: string | null = null) {
  if (!tenantId || !roles?.length) return;

  // profile_directory, not profiles: employees can only read their own profiles row.
  let query = supabase.from('profile_directory').select('id').eq('tenant_id', tenantId).in('role', roles);
  if (excludeProfileId) query = query.neq('id', excludeProfileId);

  const { data, error } = await query;
  if (error) { console.error('notifyRoles failed to resolve recipients:', error.message); return; }

  await notifyProfiles(tenantId, (data || []).map((p: any) => p.id), opts);
}

/**
 * "Full Name (Outlet)" label for a notification body — mirrors
 * src/services/notificationService.js's getRequesterLabel exactly, so a
 * request notification tells the reviewer who sent it without opening it first.
 */
export async function getRequesterLabel(profileId: string): Promise<string> {
  const { data } = await supabase
    .from('profile_directory')
    .select('first_name, middle_name, last_name, outlet_location')
    .eq('id', profileId)
    .maybeSingle();
  if (!data) return '';
  const name = [data.first_name, data.middle_name, data.last_name].filter(Boolean).join(' ');
  return data.outlet_location ? `${name} (${data.outlet_location})` : name;
}
