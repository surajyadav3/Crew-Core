import { supabase } from '@/lib/supabase';

export type EmergencyContact = { name: string; relationship: string; phone: string };
export type EducationEntry = { institution: string; degree: string; year: string };
export type ExperienceEntry = { company: string; role: string; duration: string };
export type Address = { line1?: string; line2?: string; city?: string; state?: string; pincode?: string };

export type ProfileDetails = {
  profile_id?: string;
  date_of_birth: string | null;
  gender: string;
  marital_status: string;
  blood_group: string;
  physically_handicapped: boolean;
  nationality: string;
  personal_email: string;
  work_number: string;
  residence_number: string;
  current_address: Address;
  permanent_address: Address;
  about_me: string;
  about_job: string;
  hobbies: string;
  emergency_contacts: EmergencyContact[];
  education: EducationEntry[];
  experience: ExperienceEntry[];
};

export const EMPTY_PROFILE_DETAILS: ProfileDetails = {
  date_of_birth: '',
  gender: '',
  marital_status: '',
  blood_group: '',
  physically_handicapped: false,
  nationality: 'India',
  personal_email: '',
  work_number: '',
  residence_number: '',
  current_address: {},
  permanent_address: {},
  about_me: '',
  about_job: '',
  hobbies: '',
  emergency_contacts: [],
  education: [],
  experience: [],
};

/** The current user's own profile details — returns an empty-shape default on first visit. */
export async function getMyProfileDetails(profileId: string) {
  const { data, error } = await supabase
    .from('profile_details')
    .select('*')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) return { data: null, error };
  return { data: data || { ...EMPTY_PROFILE_DETAILS, profile_id: profileId }, error: null };
}

export async function upsertProfileDetails(tenantId: string, profileId: string, payload: Partial<ProfileDetails>) {
  const { data, error } = await supabase
    .from('profile_details')
    .upsert([{ tenant_id: tenantId, profile_id: profileId, ...payload }], { onConflict: 'profile_id' })
    .select()
    .single();
  return { data, error };
}

export type CelebrationPerson = {
  id: string;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  division?: string | null;
  outlet_location?: string | null;
};
export type UpcomingCelebration = { profile: CelebrationPerson; date: string; diffDays: number; years: number };

/**
 * Upcoming birthdays + work anniversaries via the list_upcoming_celebrations() RPC
 * (payroll web repo: supabase/migrations/20260923_2_upcoming_celebrations_rpc.sql).
 * RLS only lets an employee read their own profile row, so the RPC returns just the
 * display fields — scoped to the caller's outlet for employees, whole tenant for
 * admin/manager. Mirrors the web Home page's Birthdays / Anniversaries cards.
 */
export async function listUpcomingCelebrations(days = 5) {
  const { data, error } = await supabase.rpc('list_upcoming_celebrations', { p_days: days });
  const empty = { birthdays: [] as UpcomingCelebration[], anniversaries: [] as UpcomingCelebration[] };
  if (error) return { data: empty, error };
  for (const r of (data || []) as any[]) {
    const row: UpcomingCelebration = {
      profile: {
        id: r.profile_id, first_name: r.first_name, middle_name: r.middle_name, last_name: r.last_name,
        division: r.division, outlet_location: r.outlet_location,
      },
      date: r.event_date,
      diffDays: r.days_away,
      years: r.years,
    };
    (r.kind === 'birthday' ? empty.birthdays : empty.anniversaries).push(row);
  }
  return { data: empty, error: null };
}
