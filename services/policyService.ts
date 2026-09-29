import { Platform } from 'react-native';
import * as Device from 'expo-device';
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

const deviceLabel = () =>
  [Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : Platform.OS, Device.modelName].filter(Boolean).join(' · ');

/** Policy ids this employee has already acknowledged. */
export async function listMyPolicyAcks(profileId: string) {
  const { data, error } = await supabase
    .from('policy_acknowledgements')
    .select('policy_id, acknowledged_at')
    .eq('profile_id', profileId);
  const map: Record<string, string> = {};
  (data || []).forEach((r: any) => { map[r.policy_id] = r.acknowledged_at; });
  return { acks: map, error };
}

/** "I have read and understood" — recorded as coming from the app, with the device. */
export async function acknowledgePolicy(policyId: string, profileId: string, tenantId: string) {
  const { error } = await supabase
    .from('policy_acknowledgements')
    .upsert([{ policy_id: policyId, profile_id: profileId, tenant_id: tenantId, source: 'app', device: deviceLabel() }],
      { onConflict: 'policy_id,profile_id', ignoreDuplicates: true });
  return { error };
}

/** Logs a download so HR can see who downloaded which policy from their phone. */
export async function logPolicyDownload(policyId: string, profileId: string, tenantId: string) {
  const { error } = await supabase
    .from('policy_downloads')
    .insert([{ policy_id: policyId, profile_id: profileId, tenant_id: tenantId, source: 'app', device: deviceLabel() }]);
  return { error };
}

/** Acknowledgement counts per policy (for HR's own view in the app). */
export async function listPolicyAckCounts(policyIds: string[]) {
  if (policyIds.length === 0) return { counts: {} as Record<string, number>, error: null };
  const { data, error } = await supabase.from('policy_acknowledgements').select('policy_id').in('policy_id', policyIds);
  const counts: Record<string, number> = {};
  (data || []).forEach((r: any) => { counts[r.policy_id] = (counts[r.policy_id] || 0) + 1; });
  return { counts, error };
}

/** Who acknowledged a policy, and from where. */
export async function listPolicyAcks(policyId: string) {
  const { data, error } = await supabase
    .from('policy_acknowledgements')
    .select('profile_id, acknowledged_at, source, device, profile:profiles(first_name, last_name)')
    .eq('policy_id', policyId)
    .order('acknowledged_at', { ascending: false });
  return { data: data || [], error };
}
