import { supabase } from '@/lib/supabase';
import { getOrCreateQuota, determineApproverRole, incrementSelfCount } from './requestQuotaService';

export async function listMyLeaveRequests(profileId: string) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('profile_id', profileId)
    .order('start_date', { ascending: false });
  return { data: data || [], error };
}

export async function checkProbationStatus(profileId: string) {
  const { data: prof } = await supabase
    .from('profiles')
    .select('join_date, probation_months, probation_earned_leaves')
    .eq('id', profileId)
    .single();

  if (!prof || !prof.probation_months || !prof.join_date) {
    return { inProbation: false, endsOn: null as string | null, earnedLeaves: 0 };
  }

  const [y, m, d] = prof.join_date.split('-').map(Number);
  const joinDate = new Date(y, m - 1, d);
  const endsOn = new Date(joinDate);
  endsOn.setMonth(endsOn.getMonth() + prof.probation_months);
  const inProbation = new Date() < endsOn;

  return {
    inProbation,
    endsOn: endsOn.toISOString().split('T')[0],
    earnedLeaves: prof.probation_earned_leaves || 0,
  };
}

export async function requestLeave(payload: {
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  profile_id: string;
  tenant_id: string;
  status: string;
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

  const { error } = await supabase.from('leave_requests').insert([finalPayload]);
  return { error, tier };
}
