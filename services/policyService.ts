import { supabase } from '@/lib/supabase';

export async function listPolicies(tenantId: string) {
  const { data, error } = await supabase
    .from('policies')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function createPolicy(tenantId: string, createdBy: string, title: string, body: string) {
  const { data, error } = await supabase
    .from('policies')
    .insert([{ tenant_id: tenantId, created_by: createdBy, title, body }])
    .select()
    .single();
  return { data, error };
}

export async function markPolicyRead(policyId: string, profileId: string, tenantId: string) {
  const { error } = await supabase
    .from('policy_reads')
    .upsert([{ policy_id: policyId, profile_id: profileId, tenant_id: tenantId }],
      { onConflict: 'policy_id,profile_id', ignoreDuplicates: true });
  return { error };
}

export async function listPolicyReadCounts(policyIds: string[]) {
  if (policyIds.length === 0) return { counts: {} as Record<string, number>, error: null };
  const { data, error } = await supabase.from('policy_reads').select('policy_id').in('policy_id', policyIds);
  const counts: Record<string, number> = {};
  (data || []).forEach((r: any) => { counts[r.policy_id] = (counts[r.policy_id] || 0) + 1; });
  return { counts, error };
}

export async function listPolicyReads(policyId: string) {
  const { data, error } = await supabase
    .from('policy_reads')
    .select('profile_id, read_at, profile:profiles(first_name, last_name)')
    .eq('policy_id', policyId)
    .order('read_at', { ascending: false });
  return { data: data || [], error };
}
