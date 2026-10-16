import { supabase } from '@/lib/supabase';
import { todayStr, timeStr, diffHours, checkGeofenceMulti, geofenceIsConfigured, computeEarlyLateBreach } from '@/lib/helpers';
import { getOrCreateQuota, determineApproverRole, incrementSelfCount } from './requestQuotaService';
import { resolveAttendanceSettings, listAccessibleOutlets } from './tenantService';
import { getApprovedWfhForDate } from './wfhService';
import { isFeatureEnabledForOutlet } from './featureService';
import { notifyProfiles, notifyRoles, getRequesterLabel } from './notificationService';

function sendPunchNotification(tenantId: string, profileId: string, punchType: 'in' | 'out') {
  supabase.functions.invoke('send-notification', {
    body: {
      tenant_id: tenantId,
      target: `user:${profileId}`,
      type: punchType === 'in' ? 'clock_in' : 'clock_out',
      title: punchType === 'in' ? 'Clocked In ✅' : 'Clocked Out 👋',
      body: punchType === 'in'
        ? `You clocked in at ${timeStr(new Date())}.`
        : `You clocked out at ${timeStr(new Date())}.`,
    },
  }).catch((err) => console.error('[CrewCore] send-notification (punch) error:', err));
}

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
  return { data: (data || []).map(withMispunch), error };
}

/**
 * A finished day with only a single punch (in without out, or vice versa) is
 * a Mispunch — not Present/Late. Today is left alone since the employee may
 * still punch out. Approved leave keeps its Leave status.
 */
export function withMispunch<T extends { date: string; status?: string; punches?: any[] }>(rec: T): T {
  if (rec.date < todayStr() && (rec.punches?.length || 0) === 1 && rec.status !== 'Leave') {
    return { ...rec, status: 'Mispunch' };
  }
  return rec;
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

  // Custom shift logic — computed unconditionally so the upsert below has a full
  // row ready; on conflict (row already exists) it's ignored and the existing
  // row's status/location are left untouched.
  const { data: profile } = await supabase.from('profiles').select('shift_id, outlet_id').eq('id', profileId).single();
  // Shift > outlet > company — the same precedence the DB's Late recompute uses,
  // so a factory worker on 9:30 isn't measured against the office 10:20.
  const [{ data: shift }, { data: outlet }] = await Promise.all([
    profile?.shift_id
      ? supabase.from('shifts').select('start_time').eq('id', profile.shift_id).maybeSingle()
      : Promise.resolve({ data: null as any }),
    profile?.outlet_id
      ? supabase.from('outlets').select('shift_start, late_threshold').eq('id', profile.outlet_id).maybeSingle()
      : Promise.resolve({ data: null as any }),
  ]);
  const shiftStart: string = shift?.start_time || outlet?.shift_start || tenant?.shift_start || '09:00';

  const lateMin = outlet?.late_threshold ?? tenant?.late_threshold ?? 15;
  const [sh, sm] = shiftStart.split(':').map(Number);
  const now = new Date();
  const diffMin = (now.getHours() * 60 + now.getMinutes()) - (sh * 60 + sm);
  const status = diffMin > lateMin ? 'Late' : 'Present';

  // Authoritative, server-side geofence check for clock-IN. The Attendance screen
  // already gates this client-side, but a client can't be trusted to enforce it
  // honestly — flaky/backgrounded mobile geolocation, a stale watch position, or a
  // directly-called API request can all skip that check — so this re-verifies and
  // actually rejects the punch, rather than merely flagging it. Passes if inside
  // ANY of the employee's accessible outlets. Approved WFH for today lifts the
  // requirement entirely, same as the client. A superadmin turning the
  // 'geofencing' feature off for this employee's home outlet (Toggle Services >
  // Geofencing > Scope) lifts it too — mirrors outlet_geofencing_enabled() /
  // profile_punch_is_inside_geofence() in the DB trigger, which enforces the
  // same rule for the raw INSERT. Mirrors the website's clockIn exactly.
  const [{ data: accessibleOutlets }, { data: approvedWfh }, geofencingOn] = await Promise.all([
    listAccessibleOutlets(profileId, profile?.outlet_id, tenant),
    getApprovedWfhForDate(profileId, today),
    isFeatureEnabledForOutlet(tenantId, profile?.outlet_id, 'geofencing'),
  ]);

  let outOfGeofence: boolean = false;
  if (!approvedWfh && geofencingOn && geofenceIsConfigured(accessibleOutlets || [], tenant)) {
    if (locationData?.lat == null || locationData?.lng == null) {
      throw new Error('Location is required to clock in. Please allow location access and try again.');
    }
    const result = checkGeofenceMulti(locationData.lat, locationData.lng, accessibleOutlets || [], tenant);
    if (result === true) {
      throw new Error('You are outside all of your allowed clock-in locations. Move inside one of them and try again.');
    }
    outOfGeofence = false; // reached only when inside a fence or not configured
  }

  // Atomic create-if-missing on (profile_id, date) — a select-then-insert here let a
  // double-tap (or slow network + retry) create two attendance rows for the same day.
  const { error: upsertErr } = await supabase
    .from('attendance')
    .upsert(
      [{
        tenant_id: tenantId,
        profile_id: profileId,
        date: today,
        status,
        location: 'Office',
        punch_in_lat: locationData?.lat,
        punch_in_lng: locationData?.lng,
        out_of_geofence: outOfGeofence,
      }],
      { onConflict: 'profile_id,date', ignoreDuplicates: true }
    );
  if (upsertErr) throw upsertErr;

  const { data: att, error: fetchErr } = await supabase
    .from('attendance')
    .select('id')
    .eq('profile_id', profileId)
    .eq('date', today)
    .single();
  if (fetchErr) throw fetchErr;

  // The DB holds app punches for manager approval at outlets that need it
  // (trg_punch_mark_pending_approval) — read back what it decided.
  const { data: punch, error: punchErr } = await supabase
    .from('punches')
    .insert([{ attendance_id: att.id, punch_time: timeStr(new Date()), punch_type: 'in' }])
    .select('approval_status')
    .single();
  if (punchErr) throw punchErr;

  sendPunchNotification(tenantId, profileId, 'in');
  return { pendingApproval: punch?.approval_status === 'pending' };
}

/**
 * Applies an attendance correction for one employee on one date — upserts the
 * attendance row (status recomputed from actual hours vs tenant thresholds, same
 * as clockOut), replaces that day's punches with the corrected in/out times, and
 * writes an audit log entry. Mirrors the single-employee-single-date subset of the
 * website's regularizeAttendance() bulk-edit function, since only that subset
 * applies to an employee self-approving their own regularize request.
 */
async function applyRegularization(
  tenantId: string,
  { date, clockInTime, clockOutTime, reason, changedBy }: { date: string; clockInTime: string; clockOutTime: string; reason: string; changedBy: string }
) {
  const { data: tenantData, error: tenantErr } = await supabase
    .from('tenants')
    .select('min_half_day_hours, min_full_day_hours')
    .eq('id', tenantId)
    .single();
  if (tenantErr) throw tenantErr;

  const halfMin = tenantData?.min_half_day_hours ?? 4;
  const fullMin = tenantData?.min_full_day_hours ?? 8;

  const hours = clockInTime && clockOutTime ? Math.round(diffHours(clockInTime, clockOutTime) * 100) / 100 : 0;

  let finalStatus = 'Present';
  if (hours > 0) {
    if (hours < fullMin && hours >= halfMin) finalStatus = 'Half Day';
    else if (hours < halfMin) finalStatus = 'Absent';
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('attendance')
    .select('id, status, total_hours')
    .eq('profile_id', changedBy)
    .eq('date', date)
    .maybeSingle();
  if (fetchErr) throw fetchErr;

  const action = existing ? 'update' : 'create';
  const oldStatus = existing?.status ?? null;
  const oldHours = existing?.total_hours ?? null;

  // When the row already exists, the attendance upsert below is an UPDATE, which
  // fires the DB's recompute-from-punches trigger (supabase/hardening_migration.sql)
  // — it reads whatever's in `punches` for this attendance_id *at that moment* and
  // overwrites status/total_hours with its own calculation. So the punches have to
  // be replaced first (a plain DELETE/INSERT on `punches`, which doesn't touch
  // `attendance` and doesn't fire that trigger); only then do we upsert `attendance`,
  // by which point the trigger recomputes from the corrected punches we just wrote —
  // matching finalStatus/hours instead of clobbering them with the stale pre-edit values.
  if (existing) {
    await supabase.from('punches').delete().eq('attendance_id', existing.id);
    if (clockInTime && clockOutTime) {
      const { error: prePunchErr } = await supabase
        .from('punches')
        .insert([
          { attendance_id: existing.id, punch_time: clockInTime, punch_type: 'in' },
          { attendance_id: existing.id, punch_time: clockOutTime, punch_type: 'out' },
        ]);
      if (prePunchErr) throw prePunchErr;
    }
  }

  const { data: savedAtt, error: upsertErr } = await supabase
    .from('attendance')
    .upsert(
      [{
        tenant_id: tenantId,
        profile_id: changedBy,
        date,
        status: finalStatus,
        total_hours: hours,
        location: 'Office (Regularized)',
      }],
      { onConflict: 'profile_id,date' }
    )
    .select('id')
    .single();
  if (upsertErr) throw upsertErr;
  const attId = savedAtt.id;

  // New row (no trigger involved, since it only fires on UPDATE) — punches go in
  // after, same as before.
  if (!existing && clockInTime && clockOutTime) {
    const { error: punchErr } = await supabase
      .from('punches')
      .insert([
        { attendance_id: attId, punch_time: clockInTime, punch_type: 'in' },
        { attendance_id: attId, punch_time: clockOutTime, punch_type: 'out' },
      ]);
    if (punchErr) throw punchErr;
  }

  await supabase.from('attendance_audit_log').insert([{
    tenant_id: tenantId,
    attendance_id: attId,
    profile_id: changedBy,
    changed_by: changedBy,
    date,
    action,
    old_status: oldStatus,
    new_status: finalStatus,
    old_hours: oldHours,
    new_hours: hours,
    reason: reason || '',
  }]);
}

/**
 * Employee submits a regularize request with tiered quota routing.
 * Returns { data, error, tier } where tier is 'self' | 'manager' | 'admin'.
 * When tier === 'self' the attendance change is applied immediately (no approval wait).
 */
export async function submitRegularizeRequest(
  tenantId: string,
  profileId: string,
  { date, clockInTime, clockOutTime, reason }: { date: string; clockInTime: string; clockOutTime: string; reason: string }
) {
  // Same guard as the website: nothing left to regularize once a date already
  // has a Pending or Approved request.
  const { data: existing } = await supabase
    .from('regularize_requests')
    .select('id, status')
    .eq('profile_id', profileId)
    .eq('date', date)
    .in('status', ['Pending', 'Approved'])
    .limit(1);
  if (existing?.length) {
    return {
      data: null,
      error: new Error(existing[0].status === 'Approved'
        ? `Your attendance for ${date} has already been approved — no need to request again.`
        : `You already have a pending regularization request for ${date}.`),
      tier: null,
    };
  }

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

  // Insert the request FIRST. The DB rejects it outside the tenant's
  // regularize window (enforce_regularize_request_window) and re-derives the
  // tier from the tenant's current settings (enforce_regularize_request_
  // approval_tier) — so only touch attendance / spend quota once the row has
  // actually landed, and trust the tier the server stored, not ours.
  const { data, error } = await supabase
    .from('regularize_requests')
    .insert([payload])
    .select()
    .single();
  if (error) return { data, error, tier };

  const actualTier = data?.required_approver_role || tier;
  if (actualTier === 'self') {
    await applyRegularization(tenantId, { date, clockInTime, clockOutTime, reason, changedBy: profileId });
    await incrementSelfCount(tenantId, profileId);
  }

  // Same notifications as the website's submitRegularizeRequest. Addressed
  // to the approver role + HR; for Raniwala the DB trigger
  // (trg_team_only_request_notifications) drops every manager/HOD copy
  // except the employee's own reporting line.
  if (data?.id) {
    const requester = await getRequesterLabel(profileId);
    if (actualTier === 'self') {
      await notifyProfiles(tenantId, [profileId], {
        type: 'regularize_auto_approved',
        title: 'Regularize request auto-approved',
        body: `Your attendance correction for ${date} was automatically approved.`,
        linkKey: 'regularize_attendance',
        relatedId: data.id,
      });
      await notifyRoles(tenantId, ['admin'], {
        type: 'regularize_auto_approved',
        title: 'Regularize request auto-approved',
        body: `${requester} submitted an attendance correction for ${date} — auto-approved, no action needed.`,
        linkKey: 'regularize_attendance',
        actorId: profileId,
        relatedId: data.id,
      }, profileId);
    } else {
      // An HOD approves for the people directly under them, like a manager.
      const roles = actualTier === 'manager' ? ['manager', 'hod', 'admin'] : [actualTier, 'admin'];
      await notifyRoles(tenantId, [...new Set(roles)], {
        type: 'regularize_request_submitted',
        title: 'New regularize request',
        body: `${requester} submitted a new attendance correction for ${date} — needs your review.`,
        linkKey: 'regularize_attendance',
        actorId: profileId,
        relatedId: data.id,
      }, profileId);
    }
  }
  return { data, error, tier: actualTier };
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
    .select('id, tenant_id, profile:profiles!attendance_profile_id_fkey(outlet_id, shift_id)')
    .eq('profile_id', profileId)
    .eq('date', today)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!att) throw new Error('No clock-in found for today. Please clock in first.');

  // Thresholds: the employee's home outlet override, falling back to the tenant default.
  const outletId = (att as any).profile?.outlet_id;
  const shiftId = (att as any).profile?.shift_id;
  const { data: tenantData } = await supabase
    .from('tenants')
    .select('id, min_half_day_hours, min_full_day_hours, geofence_lat, geofence_lng, geofence_radius, allow_any_outlet_clockin, shift_start, shift_end')
    .eq('id', att.tenant_id)
    .single();
  const [{ data: outlet }, { data: accessibleOutlets }, { data: approvedWfh }, geofencingOn, { data: shift }] = await Promise.all([
    outletId
      ? supabase.from('outlets').select('min_half_day_hours, min_full_day_hours, geofence_lat, geofence_lng, geofence_radius, shift_start, shift_end').eq('id', outletId).maybeSingle()
      : Promise.resolve({ data: null }),
    listAccessibleOutlets(profileId, outletId, tenantData),
    getApprovedWfhForDate(profileId, today),
    isFeatureEnabledForOutlet(att.tenant_id, outletId, 'geofencing'),
    shiftId
      ? supabase.from('shifts').select('start_time, end_time').eq('id', shiftId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Authoritative, server-side geofence check for clock-OUT — same rule as
  // clock-in (including the 'geofencing' per-outlet toggle), checked before the
  // punch is written so an out-of-fence clock-out is rejected outright instead
  // of merely flagged. Mirrors the website's clockOut exactly.
  if (!approvedWfh && geofencingOn && geofenceIsConfigured(accessibleOutlets || [], tenantData)) {
    if (locationData?.lat == null || locationData?.lng == null) {
      throw new Error('Location is required to clock out. Please allow location access and try again.');
    }
    if (checkGeofenceMulti(locationData.lat, locationData.lng, accessibleOutlets || [], tenantData) === true) {
      throw new Error('You are outside all of your allowed clock-in locations. Move inside one of them and try again.');
    }
  }

  const punchOutTime = timeStr(new Date());
  const { data: outPunch, error: punchErr } = await supabase
    .from('punches')
    .insert([{ attendance_id: att.id, punch_time: punchOutTime, punch_type: 'out' }])
    .select('approval_status')
    .single();
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

  const { min_half_day_hours: halfMin, min_full_day_hours: fullMin } = resolveAttendanceSettings(tenantData, outlet);

  let status = 'Absent';
  if (total >= fullMin) {
    status = 'Present';
  } else if (total >= halfMin) {
    status = 'Half Day';
  }

  // Early Left / Late Arrival monthly-grace counter — independent, additive,
  // visibility-only. Mirrors src/services/attendanceService.js clockOut()
  // exactly, so web and mobile punches are counted the same way.
  const sortedTimes = allPunches.map((p) => p.punch_time).sort();
  const firstPunch = sortedTimes[0];
  const lastPunch = sortedTimes[sortedTimes.length - 1];
  const effectiveShiftStart = shift?.start_time || outlet?.shift_start || tenantData?.shift_start || '10:30';
  const effectiveShiftEnd = shift?.end_time || outlet?.shift_end || tenantData?.shift_end || '18:00';
  let earlyLateFlag = false;
  let earlyLateGraced = false;
  if (computeEarlyLateBreach(firstPunch, lastPunch, effectiveShiftStart, effectiveShiftEnd)) {
    const monthStart = `${today.slice(0, 7)}-01`;
    const { count: breachCount } = await supabase
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profileId)
      // Any earlier breach day this month — graced OR counted. Counting only
      // flagged rows kept the count at 0 after the graced first breach, so
      // every breach in the month was graced. Today excluded so a re-punch
      // on the same day doesn't count itself.
      .or('early_late_flag.eq.true,early_late_graced.eq.true')
      .gte('date', monthStart)
      .lt('date', today);
    if (!breachCount) {
      earlyLateGraced = true;
    } else {
      earlyLateFlag = true;
    }
  }

  await supabase
    .from('attendance')
    .update({
      total_hours: Math.round(total * 100) / 100,
      status,
      early_late_flag: earlyLateFlag,
      early_late_graced: earlyLateGraced,
      punch_out_lat: locationData?.lat,
      punch_out_lng: locationData?.lng,
    })
    .eq('id', att.id);

  sendPunchNotification(att.tenant_id, profileId, 'out');

  return { total, pendingApproval: outPunch?.approval_status === 'pending' };
}
