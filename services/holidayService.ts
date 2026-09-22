import { supabase } from '@/lib/supabase';

/**
 * The `holidays` table has no real approval workflow — every row is treated as
 * approved unless explicitly marked otherwise — so `status` defaults to
 * 'Approved' when the column is null/absent. Without this, every holiday's
 * `status` is `undefined`, which silently fails every `status === 'Approved'`
 * check in HolidayBanner/attendance.tsx/index.tsx, making holidays invisible.
 * Mirrors the website's tenantService.js normalizeHoliday exactly.
 */
const normalizeHoliday = (h: any) => {
  const dateValue = h.holiday_date || h.date;
  return { ...h, holiday_date: dateValue, date: dateValue, status: h.status || 'Approved' };
};

/** List holidays for a tenant, ascending by date. Read-only — holiday management is admin/web-only. */
export async function listHolidays(tenantId: string) {
  const { data, error } = await supabase
    .from('holidays')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('date', { ascending: true });
  return { data: (data || []).map(normalizeHoliday), error };
}
