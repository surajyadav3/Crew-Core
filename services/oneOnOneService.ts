import { supabase } from '@/lib/supabase';

const SELECT = `
  *,
  organizer:profile_directory!one_on_ones_organizer_id_fkey(id, first_name, middle_name, last_name),
  participant:profile_directory!one_on_ones_participant_id_fkey(id, first_name, middle_name, last_name)
`;

/** Meetings where the caller is either the organizer or the participant. */
export async function listMyMeetings(tenantId: string, profileId: string) {
  const { data, error } = await supabase
    .from('one_on_ones')
    .select(SELECT)
    .eq('tenant_id', tenantId)
    .or(`organizer_id.eq.${profileId},participant_id.eq.${profileId}`)
    .order('meeting_date', { ascending: false });
  return { data: data || [], error };
}

export type ScheduleMeetingInput = {
  tenantId: string;
  organizerId: string;
  participantId: string;
  title: string;
  agendaContent: string;
  meetingDate: string;
  startTime: string | null;
  endTime: string | null;
  location: string;
};

export async function scheduleMeeting({
  tenantId, organizerId, participantId, title, agendaContent, meetingDate, startTime, endTime, location,
}: ScheduleMeetingInput) {
  const { data, error } = await supabase
    .from('one_on_ones')
    .insert([{
      tenant_id: tenantId,
      organizer_id: organizerId,
      participant_id: participantId,
      title: title || '1:1 Meeting',
      agenda_content: agendaContent || '',
      meeting_date: meetingDate,
      start_time: startTime || null,
      end_time: endTime || null,
      location: location || '',
    }])
    .select()
    .single();
  return { data, error };
}

export async function updateMeetingStatus(id: string, status: string) {
  const { error } = await supabase.from('one_on_ones').update({ status }).eq('id', id);
  return { error };
}

export async function addMeetingSummary(id: string, summary: string) {
  const { error } = await supabase
    .from('one_on_ones')
    .update({ summary, status: 'Completed' })
    .eq('id', id);
  return { error };
}
