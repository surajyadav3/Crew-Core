import { supabase } from '@/lib/supabase';

/** Configured leave types for a tenant (admin-managed). Mirrors src/services/leaveLedgerService.js. */
export async function listLeaveTypes(tenantId: string) {
  const { data, error } = await supabase
    .from('leave_types')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name');
  return { data: data || [], error };
}

/** This employee's balance per leave type — allocated/used/balance, for the "leave count" display. */
export async function fetchMyLeaveBalances(profileId: string) {
  const { data, error } = await supabase
    .from('leave_balances_detail')
    .select('*, leave_type:leave_types(name, encashable, is_unlimited)')
    .eq('profile_id', profileId);
  return { data: data || [], error };
}
