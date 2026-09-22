import { supabase } from '@/lib/supabase';
import { uploadToBucket, getSignedUrl } from '@/lib/uploadFile';

const RESUME_BUCKET = 'referral-resumes';

/** Job postings visible to the caller — RLS already filters to Open ones for regular employees. */
export async function listJobPostings(tenantId: string) {
  const { data, error } = await supabase
    .from('job_postings')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** An employee's own submitted referrals, across every posting. */
export async function listMyReferrals(profileId: string) {
  const { data, error } = await supabase
    .from('referrals')
    .select('*, job_postings(title, department)')
    .eq('referred_by', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export type ReferralInput = {
  tenant_id: string;
  job_posting_id: string;
  referred_by: string;
  candidate_name: string;
  candidate_email?: string;
  candidate_phone?: string;
  relationship?: string;
  notes?: string;
  resume_file_path?: string;
};

export async function createReferral(payload: ReferralInput) {
  const { data, error } = await supabase.from('referrals').insert([payload]).select().single();
  return { data, error };
}

/** Uploads a candidate's CV to a private bucket. Path convention: {tenant}/{referrer}/{ts}-{filename}. */
export async function uploadResume(tenantId: string, profileId: string, localUri: string, fileName: string) {
  return uploadToBucket(RESUME_BUCKET, tenantId, profileId, localUri, fileName, 'application/octet-stream');
}

export async function getResumeUrl(path: string) {
  return getSignedUrl(RESUME_BUCKET, path);
}

// ── Interviews & feedback ───────────────────────────────────────────────────

/** Interviews assigned to the calling interviewer, upcoming first — used for "My Interviews". */
export async function listMyInterviews(interviewerId: string) {
  const { data, error } = await supabase
    .from('interviews')
    .select('*, referral:referrals(candidate_name, job_postings(title))')
    .eq('interviewer_id', interviewerId)
    .order('scheduled_at');
  return { data: data || [], error };
}

export async function submitInterviewFeedback(
  interviewId: string,
  interviewerId: string,
  payload: { ratings: Record<string, number>; recommendation: string; comments: string }
) {
  const { error } = await supabase.from('interview_feedback').upsert(
    [{
      interview_id: interviewId,
      interviewer_id: interviewerId,
      ratings: payload.ratings || {},
      recommendation: payload.recommendation,
      comments: payload.comments || '',
    }],
    { onConflict: 'interview_id,interviewer_id' }
  );
  return { error };
}

export async function updateInterviewStatus(id: string, status: string) {
  const { error } = await supabase.from('interviews').update({ status }).eq('id', id);
  return { error };
}

// ── Manager/admin-only: hiring pipeline ─────────────────────────────────────

/** HR-side view — every referral in the tenant. RLS restricts this to admin/manager roles. */
export async function listAllReferrals(tenantId: string) {
  const { data, error } = await supabase
    .from('referrals')
    .select('*, job_postings(title, department), referred_by_profile:profiles!referrals_referred_by_fkey(first_name, middle_name, last_name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function listInterviewsForReferral(referralId: string) {
  const { data, error } = await supabase
    .from('interviews')
    .select('*, interviewer:profiles!interviews_interviewer_id_fkey(first_name, middle_name, last_name), feedback:interview_feedback(*)')
    .eq('referral_id', referralId)
    .order('scheduled_at');
  return { data: data || [], error };
}

export async function scheduleInterview(
  tenantId: string,
  createdBy: string,
  payload: { referral_id: string; round_name: string; interviewer_id: string; scheduled_at: string | null }
) {
  const { error } = await supabase.from('interviews').insert([{
    tenant_id: tenantId,
    referral_id: payload.referral_id,
    round_name: payload.round_name || 'Round 1',
    interviewer_id: payload.interviewer_id || null,
    scheduled_at: payload.scheduled_at || null,
    created_by: createdBy,
  }]);
  return { error };
}
