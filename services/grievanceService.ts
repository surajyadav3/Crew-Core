import { supabase } from '@/lib/supabase';
import { notifyRoles } from './notificationService';

export const GRIEVANCE_TYPES = ['Harassment', 'Discrimination', 'Workplace Safety', 'Policy Violation', 'Compensation', 'Other'];

/** Own grievances (employee) — this is deliberately narrower than most self-service tables: filer + admin/superadmin only, no manager visibility. */
export async function listMyGrievances(profileId: string) {
  const { data, error } = await supabase
    .from('grievances')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function fileGrievance(tenantId: string, profileId: string, type: string, description: string) {
  const { data: inserted, error } = await supabase.from('grievances').insert([{
    tenant_id: tenantId, profile_id: profileId, type, description,
  }]).select('id').single();

  if (!error && inserted?.id) {
    await notifyRoles(tenantId, ['admin'], {
      type: 'grievance_submitted',
      title: 'New grievance filed',
      body: `A new ${type || ''} grievance needs your attention.`,
      linkKey: 'grievances',
      actorId: profileId,
      relatedId: inserted.id,
    }, profileId);
  }

  return { error };
}
