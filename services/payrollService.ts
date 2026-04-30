import { supabase } from '@/lib/supabase';

export async function fetchMyPayslip(tenantId: string, profileId: string, month: number, year: number) {
  const { data: payroll, error: pErr } = await supabase
    .from('payrolls')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('month', month + 1)
    .eq('year', year)
    .maybeSingle();
  if (pErr) return { data: null, error: pErr };
  if (!payroll) return { data: null, error: null };

  const { data, error } = await supabase
    .from('payslips')
    .select('*')
    .eq('payroll_id', payroll.id)
    .eq('profile_id', profileId)
    .maybeSingle();
  return { data: data || null, error };
}
