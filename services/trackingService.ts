import { supabase } from '@/lib/supabase';

// Employee-side only — mirrors the employee-facing half of
// src/services/trackingService.js exactly. The admin-side map/list page
// lives on web only; not duplicated here.

/** Whether Live Tracking is currently switched on for this one employee. */
export async function getMyTrackingToggle(profileId: string): Promise<boolean> {
  const { data } = await supabase
    .from('employee_tracking_toggles')
    .select('enabled')
    .eq('employee_id', profileId)
    .maybeSingle();
  return !!data?.enabled;
}

/** Writes one GPS fix for the currently-authenticated employee. */
export async function insertPing(
  tenantId: string,
  employeeId: string,
  outletId: string | null | undefined,
  lat: number,
  lng: number,
  accuracy: number | null | undefined,
  recordedDate: string
) {
  const { error } = await supabase.from('employee_location_pings').insert([{
    tenant_id: tenantId,
    employee_id: employeeId,
    outlet_id: outletId || null,
    lat,
    lng,
    accuracy: accuracy ?? null,
    recorded_date: recordedDate,
  }]);
  return { error };
}
