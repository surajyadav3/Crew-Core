import { supabase } from '@/lib/supabase';
import { currentFinancialYear } from '@/lib/helpers';

export const TAX_CATEGORIES = ['80C', '80D', 'HRA', 'Home Loan Interest', 'Other'];

export type TaxDeclarationInput = {
  financial_year?: string;
  category: string;
  sub_category?: string;
  declared_amount: number | string;
  proof_url?: string;
};

/** One employee's own declarations for a financial year. */
export async function listMyDeclarations(profileId: string, financialYear = currentFinancialYear()) {
  const { data, error } = await supabase
    .from('tax_declarations')
    .select('*')
    .eq('profile_id', profileId)
    .eq('financial_year', financialYear)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function saveDeclaration(tenantId: string, profileId: string, payload: TaxDeclarationInput, editId: string | null = null) {
  const row = {
    tenant_id: tenantId,
    profile_id: profileId,
    financial_year: payload.financial_year || currentFinancialYear(),
    category: payload.category,
    sub_category: payload.sub_category || '',
    declared_amount: parseFloat(String(payload.declared_amount)) || 0,
    proof_url: payload.proof_url || '',
  };
  if (editId) {
    const { error } = await supabase.from('tax_declarations').update(row).eq('id', editId);
    return { error };
  }
  const { error } = await supabase.from('tax_declarations').insert([row]);
  return { error };
}

export async function deleteDeclaration(id: string) {
  const { error } = await supabase.from('tax_declarations').delete().eq('id', id);
  return { error };
}
