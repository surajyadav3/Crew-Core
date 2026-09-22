import { supabase } from '@/lib/supabase';

/**
 * Returns the company name for a given org code, or null if not found.
 * Callable before login (anon) — used for the join-company live preview.
 */
export async function lookupOrgCode(orgCode: string): Promise<{ companyName: string | null; error: any }> {
  if (!orgCode || orgCode.trim().length < 4) return { companyName: null, error: null };
  const { data, error } = await supabase.rpc('lookup_org', { p_org_code: orgCode.trim() });
  return { companyName: data || null, error };
}

/**
 * Called after the account is created (OTP-verified signup) during employee self-signup.
 * Finds the tenant by org code and creates the employee profile.
 */
export async function employeeJoinWorkspace(orgCode: string, firstName: string, lastName: string, userId: string) {
  const { data, error } = await supabase.rpc('employee_join_workspace', {
    p_org_code: orgCode.trim().toUpperCase(),
    p_first_name: firstName.trim(),
    p_last_name: lastName.trim(),
    p_user_id: userId || null,
  });
  if (error) throw error;
  return data; // 'ok'
}

export async function getOutlet(id: string | null | undefined) {
  if (!id) return { data: null, error: null };
  const { data, error } = await supabase.from('outlets').select('*').eq('id', id).maybeSingle();
  return { data, error };
}

/**
 * Every outlet a profile may clock in/out from: their home outlet plus any
 * extra access grants (profile_outlet_access) — e.g. HR who visits multiple
 * branches. Assignment happens on the web admin side; this just reads it.
 *
 * When `tenant.allow_any_outlet_clockin` is on ("multifencing", set on the web
 * admin's Settings page), the home outlet / per-employee grants are skipped
 * entirely and every active outlet in the tenant becomes a candidate fence —
 * any employee can clock in/out at any of the company's locations, just still
 * nowhere outside all of them.
 */
export async function listAccessibleOutlets(profileId: string | null | undefined, primaryOutletId: string | null | undefined, tenant?: any) {
  if (tenant?.allow_any_outlet_clockin && tenant?.id) {
    const { data, error } = await supabase.from('outlets').select('*').eq('tenant_id', tenant.id).eq('is_active', true);
    return { data: data || [], error };
  }

  const ids = new Set<string>();
  if (primaryOutletId) ids.add(primaryOutletId);
  if (profileId) {
    const { data } = await supabase.from('profile_outlet_access').select('outlet_id').eq('profile_id', profileId);
    (data || []).forEach((r: any) => ids.add(r.outlet_id));
  }
  if (!ids.size) return { data: [], error: null };
  const { data, error } = await supabase.from('outlets').select('*').in('id', Array.from(ids));
  return { data: data || [], error };
}

// An outlet's own geofence/min-hours override the tenant-wide default when set.
export function resolveAttendanceSettings(tenant: any, outlet: any) {
  return {
    geofence_lat: outlet?.geofence_lat ?? tenant?.geofence_lat ?? null,
    geofence_lng: outlet?.geofence_lng ?? tenant?.geofence_lng ?? null,
    geofence_radius: outlet?.geofence_radius ?? tenant?.geofence_radius ?? 200,
    min_half_day_hours: outlet?.min_half_day_hours ?? tenant?.min_half_day_hours ?? 4,
    min_full_day_hours: outlet?.min_full_day_hours ?? tenant?.min_full_day_hours ?? 8,
  };
}
