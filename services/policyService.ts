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
