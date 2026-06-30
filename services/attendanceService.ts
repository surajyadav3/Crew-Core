import { supabase } from '@/lib/supabase';
import { todayStr, timeStr, diffHours } from '@/lib/helpers';
import { getOrCreateQuota, determineApproverRole, incrementSelfCount } from './requestQuotaService';

export async function fetchMyMonthAttendance(profileId: string, year: number, month: number) {
  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endDay = new Date(year, month + 1, 0).getDate();
  const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${endDay}`;

  const { data, error } = await supabase
    .from('attendance')
    .select('*, punches(*)')
    .eq('profile_id', profileId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date');
  return { data: data || [], error };
}

export async function fetchMyMonthStats(profileId: string, year: number, month: number) {
  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endDay = new Date(year, month + 1, 0).getDate();
  const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${endDay}`;

  const { data, error } = await supabase
    .from('attendance')
    .select('status')
    .eq('profile_id', profileId)
    .gte('date', startDate)
    .lte('date', endDate);

  const presentDays = (data || []).filter((r) => r.status === 'Present' || r.status === 'Late').length;
  return { presentDays, error };
}

export async function clockIn(tenantId: string, profileId: string, tenant: any, locationData: { lat: number; lng: number } | null = null) {
  const today = todayStr();

  const { data: existing, error: fetchErr } = await supabase
    .from('attendance')
    .select('id')
    .eq('profile_id', profileId)
    .eq('date', today)
    .maybeSingle();
  if (fetchErr) throw fetchErr;

  let attId: string;

  if (existing) {
    attId = existing.id;
  } else {
    const { data: profile } = await supabase.from('profiles').select('shift_id').eq('id', profileId).single();
    let shiftStart = tenant?.shift_start || '09:00';
    if (profile?.shift_id) {
      const { data: shift } = await supabase.from('shifts').select('start_time').eq('id', profile.shift_id).single();
      if (shift) shiftStart = shift.start_time;
    }

    const lateMin = tenant?.late_threshold || 15;
    const [sh, sm] = shiftStart.split(':').map(Number);
    const now = new Date();
    const diffMin = (now.getHours() * 60 + now.getMinutes()) - (sh * 60 + sm);
    const status = diffMin > lateMin ? 'Late' : 'Present';

    const { data: newAtt, error: insErr } = await supabase
      .from('attendance')
      .insert([{
        tenant_id: tenantId,
        profile_id: profileId,
        date: today,
        status,
        location: 'Office',
        punch_in_lat: locationData?.lat,
        punch_in_lng: locationData?.lng,
      }])
      .select()
      .single();
    if (insErr) throw insErr;
    attId = newAtt.id;
  }

  const { error: punchErr } = await supabase
    .from('punches')
    .insert([{ attendance_id: attId, punch_time: timeStr(new Date()), punch_type: 'in' }]);
  if (punchErr) throw punchErr;
}

export async function submitRegularizeRequest(
  tenantId: string,
  profileId: string,
  { date, clockInTime, clockOutTime, reason }: { date: string; clockInTime: string; clockOutTime: string; reason: string }
) {
  const quota = await getOrCreateQuota(tenantId, profileId);
  const tier = determineApproverRole(quota);

  const payload = {
    tenant_id: tenantId,
    profile_id: profileId,
    date,
    clock_in_time: clockInTime || null,
    clock_out_time: clockOutTime || null,
    reason,
    status: tier === 'self' ? 'Approved' : 'Pending',
    required_approver_role: tier,
    approval_level: tier === 'self' ? 'self' : null,
  };

  if (tier === 'self') {
    await incrementSelfCount(tenantId, profileId);
  }

  const { data, error } = await supabase
    .from('regularize_requests')
    .insert([payload])
    .select()
    .single();
  return { data, error, tier };
}

export async function listMyRegularizeRequests(profileId: string) {
  const { data, error } = await supabase
    .from('regularize_requests')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(30);
  return { data: data || [], error };
}

export async function clockOut(profileId: string, locationData: { lat: number; lng: number } | null = null) {
  const today = todayStr();

  const { data: att, error: fetchErr } = await supabase
    .from('attendance')
    .select('id, tenant_id')
    .eq('profile_id', profileId)
    .eq('date', today)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!att) throw new Error('No clock-in found for today. Please clock in first.');

  const punchOutTime = timeStr(new Date());
  const { error: punchErr } = await supabase
    .from('punches')
    .insert([{ attendance_id: att.id, punch_time: punchOutTime, punch_type: 'out' }]);
  if (punchErr) throw punchErr;

  const { data: allPunches, error: allErr } = await supabase
    .from('punches')
    .select('*')
    .eq('attendance_id', att.id)
    .order('punch_time');
  if (allErr) throw allErr;

  const ins = allPunches.filter((p) => p.punch_type === 'in');
  const outs = allPunches.filter((p) => p.punch_type === 'out');
  let total = 0;
  for (let i = 0; i < ins.length; i++) {
    if (outs[i]) total += diffHours(ins[i].punch_time, outs[i].punch_time);
  }

  const { data: tenantData } = await supabase
    .from('tenants')
    .select('min_half_day_hours, min_full_day_hours')
    .eq('id', att.tenant_id)
    .single();
  const halfMin = tenantData?.min_half_day_hours || 1;
  const fullMin = tenantData?.min_full_day_hours || 8;

  const status = total >= fullMin ? 'Present' : total > halfMin ? 'Half Day' : 'Absent';

  await supabase
    .from('attendance')
    .update({
      total_hours: Math.round(total * 100) / 100,
      status,
      punch_out_lat: locationData?.lat,
      punch_out_lng: locationData?.lng,
    })
    .eq('id', att.id);

  return { total };
}
