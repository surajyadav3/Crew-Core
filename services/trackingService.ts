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

export type PingRow = {
  tenant_id: string;
  employee_id: string;
  outlet_id: string | null;
  lat: number;
  lng: number;
  accuracy: number | null;
  recorded_at: string;
  recorded_date: string;
};

/**
 * Writes several fixes in one request, each stamped with the time the phone
 * took it (recorded_at) — used by the background task to flush pings it had
 * to hold back while the phone was offline.
 */
export async function insertPings(rows: PingRow[]) {
  const { error } = await supabase.from('employee_location_pings').insert(rows);
  return { error };
}

/**
 * Whether the background task should keep recording: tracking toggle on AND
 * clocked in on `date` (DB rule, live_tracking_should_record — 20260929_6).
 * Returns null when the check itself failed (offline), so the caller can keep
 * its last known answer instead of stopping on a network blip.
 */
export async function shouldRecordLocation(date: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('live_tracking_should_record', { p_date: date });
  if (error) return null;
  return !!data;
}
