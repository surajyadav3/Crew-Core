import { supabase } from '@/lib/supabase';
import { notifyRoles } from './notificationService';

export const EXPENSE_CATEGORIES = ['Travel', 'Meals', 'Accommodation', 'Supplies', 'Client Entertainment', 'Other'];
export const RECEIPT_BUCKET = 'expense-receipts';

export type ExpenseClaimItemInput = {
  category: string;
  amount: number | string;
  description?: string;
  receipt_path?: string;
};

export async function listMyExpenseClaims(profileId: string) {
  const { data, error } = await supabase
    .from('expense_claims')
    .select('*, items:expense_claim_items(*)')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

/** Creates the claim + its line items in one call. */
export async function createExpenseClaim(
  tenantId: string,
  profileId: string,
  advanceId: string | null,
  items: ExpenseClaimItemInput[],
) {
  const totalAmount = items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  const { data: claim, error } = await supabase.from('expense_claims').insert([{
    tenant_id: tenantId, profile_id: profileId, advance_id: advanceId || null, total_amount: totalAmount,
  }]).select().single();
  if (error) return { error };

  const rows = items.map((i) => ({
    claim_id: claim.id, category: i.category, amount: Number(i.amount) || 0,
    description: i.description || '', receipt_path: i.receipt_path || '',
  }));
  const { error: itemErr } = await supabase.from('expense_claim_items').insert(rows);

  if (!itemErr) {
    await notifyRoles(tenantId, ['admin', 'manager'], {
      type: 'expense_claim_submitted',
      title: 'New expense claim',
      body: `A new expense claim (${totalAmount}) needs your review.`,
      linkKey: 'expense_claims',
      actorId: profileId,
      relatedId: claim.id,
    }, profileId);
  }

  return { error: itemErr, claimId: claim.id as string };
}

export async function deleteExpenseClaim(id: string) {
  const { error } = await supabase.from('expense_claims').delete().eq('id', id);
  return { error };
}
