import { supabase } from '@/lib/supabase';

const REVIEW_LIST_SELECT = `
  *,
  cycle:review_cycles(*),
  reporting_manager:profiles!reviews_reporting_manager_id_fkey(first_name, middle_name, last_name)
`;

export async function listMyReviews(tenantId: string, profileId: string) {
  const { data, error } = await supabase
    .from('reviews')
    .select(REVIEW_LIST_SELECT)
    .eq('tenant_id', tenantId)
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Full detail for the review form: questions, answers, and my KRAs with any manager ratings. */
export async function getReviewDetail(reviewId: string, profileId: string) {
  const { data: review, error: reviewErr } = await supabase
    .from('reviews')
    .select(REVIEW_LIST_SELECT)
    .eq('id', reviewId)
    .single();
  if (reviewErr) return { error: reviewErr, data: null };

  const [{ data: questions }, { data: answers }, { data: kras }, { data: kraRatings }] = await Promise.all([
    supabase.from('review_questions').select('*').eq('cycle_id', review.cycle_id).order('order_index'),
    supabase.from('review_answers').select('*').eq('review_id', reviewId),
    supabase.from('kras').select('*, kra_kpis(*)').eq('profile_id', profileId),
    supabase.from('review_kra_ratings').select('*').eq('review_id', reviewId),
  ]);

  return {
    data: {
      review,
      questions: questions || [],
      answers: answers || [],
      kras: kras || [],
      kraRatings: kraRatings || [],
    },
    error: null,
  };
}

export async function submitReviewAnswer({ reviewId, questionId, answeredBy, rating, comment }: {
  reviewId: string; questionId: string; answeredBy: string; rating: number | null; comment: string;
}) {
  const { error } = await supabase
    .from('review_answers')
    .upsert(
      [{ review_id: reviewId, question_id: questionId, answered_by: answeredBy, rating: rating ?? null, comment: comment || '' }],
      { onConflict: 'review_id,question_id,answered_by' }
    );
  if (!error) await supabase.from('reviews').update({ status: 'In Progress' }).eq('id', reviewId).eq('status', 'Not Started');
  return { error };
}
