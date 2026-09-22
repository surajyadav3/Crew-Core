import { supabase } from '@/lib/supabase';

export async function fetchMySkillMap(profileId: string) {
  const { data, error } = await supabase
    .from('employee_skills')
    .select('*, skill:skills(name, category)')
    .eq('profile_id', profileId);
  return { data: data || [], error };
}

export async function listTrainingEvents(tenantId: string) {
  const { data, error } = await supabase
    .from('training_events')
    .select('*, program:training_programs(title, description), enrollments:training_enrollments(id, profile_id, status)')
    .eq('tenant_id', tenantId)
    .order('event_date', { ascending: false });
  return { data: data || [], error };
}

/** An employee's own enrollments, across every event. */
export async function listMyEnrollments(profileId: string) {
  const { data, error } = await supabase
    .from('training_enrollments')
    .select('*, event:training_events(event_date, trainer, location, program:training_programs(title))')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function enrollInEvent(tenantId: string, eventId: string, profileId: string) {
  const { error } = await supabase.from('training_enrollments').insert([{ tenant_id: tenantId, event_id: eventId, profile_id: profileId }]);
  return { error };
}

export async function submitTrainingFeedback(id: string, rating: number, notes: string) {
  const { error } = await supabase.from('training_enrollments').update({ feedback_rating: rating, feedback_notes: notes || '' }).eq('id', id);
  return { error };
}
