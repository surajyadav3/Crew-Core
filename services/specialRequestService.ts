import { supabase } from '@/lib/supabase';
import { getOrCreateQuota, determineApproverRole, incrementSelfCount } from './requestQuotaService';

export async function listMySpecialRequests(profileId: string) {
  const { data, error } = await supabase
    .from('special_requests')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function submitSpecialRequest(payload: {
  profile_id: string;
  tenant_id: string;
  request_type: string;
  request_date: string;
  reason: string;
  status: string;
  late_hours?: string | null;
  overtime_hours?: number | null;
  overtime_minutes?: number | null;
  overtime_pay?: number | null;
}) {
  const { tenant_id, profile_id } = payload;

  const quota = await getOrCreateQuota(tenant_id, profile_id);
  const tier = determineApproverRole(quota);

  const finalPayload = {
    ...payload,
    status: tier === 'self' ? 'Approved' : 'Pending',
    required_approver_role: tier,
    approval_level: tier === 'self' ? 'self' : null,
  };

  if (tier === 'self') {
    await incrementSelfCount(tenant_id, profile_id);
  }

  const { error } = await supabase.from('special_requests').insert([finalPayload]);
  return { error, tier };
}
