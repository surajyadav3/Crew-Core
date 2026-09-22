import { supabase } from '@/lib/supabase';

export async function fetchMyPayslip(tenantId: string, profileId: string, month: number, year: number) {
  // There can be two payroll records per month (India + International country
  // groups), so fetch every payroll id for the month and search payslips across
  // all of them — a single .maybeSingle() on payrolls throws once a tenant has both.
  const { data: payrolls, error: pErr } = await supabase
    .from('payrolls')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('month', month + 1)
    .eq('year', year);
  if (pErr) return { data: null, error: pErr };
  if (!payrolls?.length) return { data: null, error: null };

  // .limit(1) + take-first instead of .maybeSingle(): a profile is expected to
  // match exactly one of the payroll ids above, but .maybeSingle() throws
  // outright if it ever matches more than one (e.g. a mid-month country-group
  // transfer leaves payslip rows under both), which would break payslip
  // loading entirely instead of just showing one of the matches.
  const { data, error } = await supabase
    .from('payslips')
    .select('*')
    .eq('profile_id', profileId)
    .in('payroll_id', payrolls.map((p) => p.id))
    .limit(1);
  return { data: data?.[0] || null, error };
}
