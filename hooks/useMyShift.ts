import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

export type MyShift = { name: string | null; start: string | null; end: string | null };

/**
 * The signed-in employee's own working hours: assigned shift > outlet > company.
 * Same precedence the DB uses to mark Late (trg_recompute_attendance_from_punches,
 * essl_apply_to_attendance), so what the app shows matches how late is counted —
 * e.g. Raniwala factory staff work 9:30–6:00, not the company's 10:20–7:15.
 */
export function resolveShift(shift: any, outlet: any, tenant: any): MyShift {
  const start = shift?.start_time || outlet?.shift_start || tenant?.shift_start || null;
  const end = shift?.end_time || outlet?.shift_end || tenant?.shift_end || null;
  return {
    name: shift?.name || (outlet?.shift_start ? outlet?.name : null) || null,
    start: start ? String(start).slice(0, 5) : null,
    end: end ? String(end).slice(0, 5) : null,
  };
}

export function useMyShift(): MyShift {
  const { profile, tenant } = useAuth();
  const [rows, setRows] = useState<{ shift: any; outlet: any }>({ shift: null, outlet: null });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      profile?.shift_id
        ? supabase.from('shifts').select('name, start_time, end_time').eq('id', profile.shift_id).maybeSingle()
        : Promise.resolve({ data: null }),
      profile?.outlet_id
        ? supabase.from('outlets').select('name, shift_start, shift_end').eq('id', profile.outlet_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]).then(([s, o]) => { if (!cancelled) setRows({ shift: s.data, outlet: o.data }); });
    return () => { cancelled = true; };
  }, [profile?.shift_id, profile?.outlet_id]);

  return resolveShift(rows.shift, rows.outlet, tenant);
}
