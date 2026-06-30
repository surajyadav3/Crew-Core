import { supabase } from '@/lib/supabase';

export const SELF_LIMIT = 3;
export const MANAGER_LIMIT = 5;

function currentMonthYear() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export async function getOrCreateQuota(tenantId: string, profileId: string) {
  const { month, year } = currentMonthYear();

  const { data: existing } = await supabase
    .from('request_quotas')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('profile_id', profileId)
    .eq('month', month)
    .eq('year', year)
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await supabase
    .from('request_quotas')
    .upsert([{ tenant_id: tenantId, profile_id: profileId, month, year }], {
      onConflict: 'tenant_id,profile_id,month,year',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export function determineApproverRole(quota: any): 'self' | 'manager' | 'admin' {
  if (quota.self_approved_count < SELF_LIMIT) return 'self';
  if (quota.manager_approved_count < MANAGER_LIMIT) return 'manager';
  return 'admin';
}

export async function incrementSelfCount(tenantId: string, profileId: string) {
  const quota = await getOrCreateQuota(tenantId, profileId);
  const { error } = await supabase
    .from('request_quotas')
    .update({ self_approved_count: quota.self_approved_count + 1, updated_at: new Date().toISOString() })
    .eq('id', quota.id);
  if (error) throw error;
}

export async function incrementManagerCount(tenantId: string, profileId: string) {
  const quota = await getOrCreateQuota(tenantId, profileId);
  const { error } = await supabase
    .from('request_quotas')
    .update({ manager_approved_count: quota.manager_approved_count + 1, updated_at: new Date().toISOString() })
    .eq('id', quota.id);
  if (error) throw error;
}

export async function fetchMyQuota(tenantId: string, profileId: string) {
  const { month, year } = currentMonthYear();
  const { data } = await supabase
    .from('request_quotas')
    .select('self_approved_count, manager_approved_count')
    .eq('tenant_id', tenantId)
    .eq('profile_id', profileId)
    .eq('month', month)
    .eq('year', year)
    .maybeSingle();

  return {
    selfUsed: data?.self_approved_count || 0,
    selfLimit: SELF_LIMIT,
    managerUsed: data?.manager_approved_count || 0,
    managerLimit: MANAGER_LIMIT,
  };
}
