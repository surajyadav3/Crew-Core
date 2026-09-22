import { supabase } from '@/lib/supabase';
import { notifyRoles } from './notificationService';

export const TRAVEL_MODES = ['Flight', 'Train', 'Bus', 'Cab', 'Own Vehicle', 'Other'];

export type TravelLegInput = { from_city: string; to_city: string; travel_date: string; mode: string };
export type TravelRequestInput = { purpose: string; from_date: string; to_date: string; estimated_cost: number | string };

export async function listMyTravelRequests(profileId: string) {
  const { data, error } = await supabase
    .from('travel_requests')
    .select('*, legs:travel_legs(*)')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function createTravelRequest(
  tenantId: string, profileId: string, payload: TravelRequestInput, legs: TravelLegInput[] = [],
) {
  const { data: req, error } = await supabase.from('travel_requests').insert([{
    tenant_id: tenantId, profile_id: profileId, purpose: payload.purpose,
    from_date: payload.from_date, to_date: payload.to_date, estimated_cost: parseFloat(String(payload.estimated_cost)) || 0,
  }]).select().single();
  if (error) return { error };

  if (legs.length) {
    const rows = legs.map((l) => ({ travel_request_id: req.id, from_city: l.from_city, to_city: l.to_city, travel_date: l.travel_date, mode: l.mode }));
    const { error: legErr } = await supabase.from('travel_legs').insert(rows);
    if (legErr) return { error: legErr };
  }

  await notifyRoles(tenantId, ['admin', 'manager'], {
    type: 'travel_request_submitted',
    title: 'New travel request',
    body: `A new travel request (${payload.purpose || ''}) needs your review.`,
    linkKey: 'travel_requests',
    actorId: profileId,
    relatedId: req.id,
  }, profileId);

  return { error: null, requestId: req.id as string };
}

export async function deleteTravelRequest(id: string) {
  const { error } = await supabase.from('travel_requests').delete().eq('id', id);
  return { error };
}
