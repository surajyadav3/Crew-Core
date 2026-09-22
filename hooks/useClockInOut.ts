import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as StoreReview from 'expo-store-review';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  fetchMyMonthAttendance,
  clockIn as svcClockIn,
  clockOut as svcClockOut,
} from '@/services/attendanceService';
import { getApprovedWfhForDate } from '@/services/wfhService';
import { listAccessibleOutlets, resolveAttendanceSettings } from '@/services/tenantService';
import { isFeatureEnabledForOutlet } from '@/services/featureService';
import { showToast } from '@/components/Toast';
import { todayStr, timeStr, diffHours, fmtTime12, fmtDuration, fmtHMS, calculateDistance, fmtLiveClock, fmtLiveDate } from '@/lib/helpers';
import { presentLocalNotification } from '@/lib/pushNotifications';
import { useLiveTrackingCapture } from '@/hooks/useLiveTrackingCapture';

const CLOCK_OUT_COUNT_KEY = 'clock_out_count';

// Reject a GPS fix worse than this — an imprecise reading can't be trusted to
// confirm the employee is actually inside the fence. Matches the web app's
// threshold so the geofence enforces the same standard everywhere.
const MAX_LOCATION_ACCURACY_M = 150;

async function maybeAskReview() {
  try {
    const raw = await AsyncStorage.getItem(CLOCK_OUT_COUNT_KEY);
    const count = parseInt(raw || '0', 10) + 1;
    await AsyncStorage.setItem(CLOCK_OUT_COUNT_KEY, String(count));
    if (count === 3 && await StoreReview.hasAction()) await StoreReview.requestReview();
  } catch {}
}

/**
 * Clock in/out state + actions shared between the Home and Attendance screens
 * — extracted so both surfaces punch in/out through the exact same geofence
 * check and punch state instead of drifting out of sync. Deliberately scoped
 * to *today's* punch state only; calendar/month-history data stays local to
 * whichever screen renders it (Attendance's month calendar).
 */
export function useClockInOut() {
  const { profile, tenant } = useAuth();
  // Both the Home and Attendance screens mount this hook at once (tab screens
  // stay mounted), and supabase-js dedupes `.channel()` calls by topic name —
  // so a bare `outlets-${tenant.id}` topic makes the second instance reuse the
  // first's already-subscribed channel, and its `.on()` call throws ("cannot
  // add `postgres_changes` callbacks ... after `subscribe()`"). Scoping the
  // topic to this hook instance keeps each screen's channel independent.
  const instanceId = useId();
  const [myPunches, setMyPunches] = useState<any>({});
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [locationStatus, setLocationStatus] = useState('Loading…');
  const [liveClock, setLiveClock] = useState('');
  const [liveDate, setLiveDate] = useState('');
  const [timerDisplay, setTimerDisplay] = useState('00:00:00');
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [actionLoading, setActionLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accessibleOutlets, setAccessibleOutlets] = useState<any[]>([]);
  const [outletGeofencingOff, setOutletGeofencingOff] = useState(false);

  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const actionLoadingRef = useRef(false);
  useEffect(() => { actionLoadingRef.current = actionLoading; }, [actionLoading]);

  const refresh = useCallback(async () => {
    if (!profile || !tenant) return;
    const now = new Date();
    const { data, error } = await fetchMyMonthAttendance(profile.id, now.getFullYear(), now.getMonth());
    if (error) { showToast('Could not load attendance records.', 'error'); return; }
    const todayRec = data.find((r: any) => r.date === todayStr());
    if (todayRec) {
      const ins = (todayRec.punches || []).filter((p: any) => p.punch_type === 'in').length;
      const outs = (todayRec.punches || []).filter((p: any) => p.punch_type === 'out').length;
      setIsClockedIn(ins > outs);
      setMyPunches(todayRec);
    } else {
      setIsClockedIn(false);
      setMyPunches({});
    }
  }, [profile, tenant]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Live Tracking (premium, opt-in per employee) — a no-op for every
  // tenant/employee it isn't turned on for. See hooks/useLiveTrackingCapture.ts.
  useLiveTrackingCapture({ profile, tenant, isClockedIn });

  // Live cross-device sync: a punch made from the web browser (or any other
  // signed-in device) lands in `punches` immediately, and RLS restricts what
  // this subscription receives to this employee's own rows — so this fires
  // only for this profile's punches. Without it, each surface only knew its
  // own punch history from the one-shot `refresh()` above, so clocking in on
  // the web left the app showing a stale "Clock In" button (and vice versa)
  // until the screen was backgrounded and refocused.
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`punches-${profile.id}-${instanceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'punches' },
        (payload) => {
          refresh();
          // Skip the "synced" toast/notification for a punch this exact
          // device just made itself — handleClockIn/handleClockOut below
          // already show their own toast + notification for that.
          if (actionLoadingRef.current) return;
          const punchType = payload.new?.punch_type;
          if (punchType === 'in') {
            const inTime = fmtTime12(timeStr(new Date()));
            showToast(`Clocked in at ${inTime} (synced)`, 'success');
            presentLocalNotification('Clocked In ✓', `Synced from another device — clocked in at ${inTime}.`, { type: 'clock_in' });
          } else if (punchType === 'out') {
            showToast('Clocked out (synced from another device)', 'success');
            presentLocalNotification('Clocked Out', 'Synced from another device.', { type: 'clock_out' });
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, instanceId, refresh]);

  // Resync on foreground resume. The realtime channel above rides a websocket
  // that the OS suspends along with everything else while backgrounded, so a
  // punch made elsewhere (web, another device) — or even just the clock
  // ticking past midnight — while this device was backgrounded doesn't arrive
  // as an event once the socket reconnects. Re-running `refresh()` whenever
  // the app comes back to 'active' re-derives isClockedIn straight from the
  // server (the actual source of truth) instead of trusting whatever state
  // was left on screen before backgrounding.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // Live clock ticker.
  useEffect(() => {
    const tick = () => { setLiveClock(fmtLiveClock(new Date())); setLiveDate(fmtLiveDate(new Date())); };
    tick();
    clockRef.current = setInterval(tick, 1000);
    return () => { if (clockRef.current) clearInterval(clockRef.current); };
  }, []);

  // Today's-hours ticker, driven off myPunches. Completed in/out pairs use
  // diffHours (punch_time only carries HH:MM, so minute precision is all the
  // stored data supports), but the currently-open pair — if any — is timed
  // against the real Date instead: diffHours(in, timeStr(now)) used to
  // quantize "now" down to HH:MM too, so the seconds digit was always a
  // multiple of 60 and only visibly moved once a minute instead of ticking.
  useEffect(() => {
    const tickTimer = () => {
      const todayRec = myPunches;
      if (!todayRec?.punches?.length) { setTimerDisplay('00:00:00'); setTimerSeconds(0); return; }
      const sorted = [...todayRec.punches].sort((a: any, b: any) => a.punch_time.localeCompare(b.punch_time));
      let totalSecs = 0;
      const ins = sorted.filter((p: any) => p.punch_type === 'in');
      const outs = sorted.filter((p: any) => p.punch_type === 'out');
      const now = new Date();
      for (let i = 0; i < ins.length; i++) {
        if (outs[i]) {
          totalSecs += diffHours(ins[i].punch_time, outs[i].punch_time) * 3600;
        } else {
          const [inH, inM] = ins[i].punch_time.split(':').map(Number);
          const inDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), inH, inM, 0);
          totalSecs += Math.max(0, (now.getTime() - inDate.getTime()) / 1000);
        }
      }
      setTimerDisplay(fmtHMS(totalSecs));
      setTimerSeconds(totalSecs);
    };
    tickTimer();
    timerRef.current = setInterval(tickTimer, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [myPunches]);

  // Every outlet this profile may clock in/out from — their home outlet plus
  // any extra multi-outlet access grants (e.g. HR visiting other branches).
  const fetchAccessibleOutlets = useCallback(() => {
    if (!profile?.id) { setAccessibleOutlets([]); return; }
    listAccessibleOutlets(profile.id, profile.outlet_id, tenant).then(({ data }) => setAccessibleOutlets(data || []));
  }, [profile?.id, profile?.outlet_id, tenant]);

  useEffect(() => { fetchAccessibleOutlets(); }, [fetchAccessibleOutlets, tenant?.allow_any_outlet_clockin]);

  // Per-outlet superadmin toggle (Toggle Services > Geofencing, Scope: an
  // outlet) — checked against the employee's own outlet, same as the
  // server-side profile_punch_is_inside_geofence() and the website's
  // useGeofenceClock. Lets a superadmin exempt one outlet's staff from the
  // fence without having to clear that outlet's (or the tenant's) stored
  // coordinates.
  useEffect(() => {
    if (!tenant?.id) { setOutletGeofencingOff(false); return; }
    let cancelled = false;
    isFeatureEnabledForOutlet(tenant.id, profile?.outlet_id || null, 'geofencing').then((enabled) => {
      if (!cancelled) setOutletGeofencingOff(!enabled);
    });
    return () => { cancelled = true; };
  }, [tenant?.id, profile?.outlet_id]);

  // Live sync: if an admin changes an outlet's geofence (or adds/removes one)
  // on the web while this hook is mounted, re-resolve accessible outlets
  // immediately instead of waiting for the next screen focus. Tenant-wide
  // geofence defaults are synced separately, in AuthContext (tenant state).
  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(`outlets-${tenant.id}-${instanceId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'outlets', filter: `tenant_id=eq.${tenant.id}` },
        () => fetchAccessibleOutlets())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenant?.id, fetchAccessibleOutlets, instanceId]);

  // One candidate fence per accessible outlet, each falling back to the tenant
  // default when that outlet has no override — a profile with no extra access
  // grants ends up with exactly one candidate (their home outlet), unchanged
  // from the single-outlet behavior.
  const fenceCandidates = outletGeofencingOff ? [] : (accessibleOutlets.length ? accessibleOutlets : [null])
    .map((outlet) => ({ ...resolveAttendanceSettings(tenant, outlet), name: outlet?.name }))
    .filter((c) => c.geofence_lat != null && c.geofence_lng != null)
    .map((c) => ({ lat: c.geofence_lat, lng: c.geofence_lng, radius: c.geofence_radius, name: c.name }));
  const multiOutlet = fenceCandidates.length > 1;

  useEffect(() => {
    if (!tenant) return;
    setLocationStatus(fenceCandidates.length
      ? 'Tap clock in to verify location'
      : outletGeofencingOff ? 'Geofencing disabled for your outlet' : 'Geofencing not configured');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, fenceCandidates.length, outletGeofencingOff]);

  // Checks a position against every candidate fence; returns whichever one it's
  // inside (if any), else the nearest miss ranked by how far past that outlet's
  // own radius the position is (not raw distance).
  const evaluateFences = (lat: number, lng: number) => {
    let nearest: { dist: number; overshoot: number; name?: string } | null = null;
    for (const c of fenceCandidates) {
      const dist = calculateDistance(lat, lng, c.lat, c.lng);
      if (dist <= c.radius) return { inside: true, dist, name: c.name };
      const overshoot = dist - c.radius;
      if (!nearest || overshoot < nearest.overshoot) nearest = { dist, overshoot, name: c.name };
    }
    return { inside: false, dist: nearest?.dist ?? 0, name: nearest?.name };
  };

  const resolveClockLocation = useCallback(async (): Promise<{ loc: { lat: number; lng: number } | null; msg: string }> => {
    if (profile?.id) {
      const { data: wfh } = await getApprovedWfhForDate(profile.id, todayStr());
      if (wfh) {
        setLocationStatus('Approved WFH today — location check skipped');
        return { loc: { lat: 0, lng: 0 }, msg: 'Approved WFH today — location check skipped' };
      }
    }
    if (!fenceCandidates.length) {
      setLocationStatus('Geofencing not configured');
      return { loc: { lat: 0, lng: 0 }, msg: 'Geofencing not configured' };
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      const msg = 'Location permission denied';
      setLocationStatus(msg);
      return { loc: null, msg };
    }
    try {
      // GPS can take an unusually long time to get a fix right after the app
      // resumes from background (location services need a moment to spin
      // back up), and getCurrentPositionAsync has no built-in timeout — left
      // unbounded, that stranded the Clock In/Out button in its loading spinner
      // indefinitely, reading as the whole screen having frozen. Race it against
      // a hard cap so the button always resolves one way or another.
      const pos = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('location-timeout')), 15000)),
      ]);
      const accuracy = pos.coords.accuracy;
      if (accuracy != null && accuracy > MAX_LOCATION_ACCURACY_M) {
        const msg = `Location too imprecise to verify (±${Math.round(accuracy)}m) — move to an open area and try again`;
        setLocationStatus(msg);
        return { loc: null, msg };
      }
      const { inside, dist, name } = evaluateFences(pos.coords.latitude, pos.coords.longitude);
      if (!inside) {
        const msg = multiOutlet
          ? `Outside your allowed outlets (${Math.round(dist)}m from ${name || 'nearest one'})`
          : `Outside office area (${Math.round(dist)}m away)`;
        setLocationStatus(msg);
        return { loc: null, msg };
      }
      setLocationStatus(multiOutlet
        ? `Within ${name} · ${Math.round(dist)}m from centre ✓`
        : `Within office area · ${Math.round(dist)}m from centre ✓`);
      return { loc: { lat: pos.coords.latitude, lng: pos.coords.longitude }, msg: 'Within office area ✓' };
    } catch {
      const msg = 'Unable to get location — check GPS';
      setLocationStatus(msg);
      return { loc: null, msg };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, fenceCandidates, multiOutlet]);

  const handleClockIn = useCallback(async () => {
    if (!profile || !tenant) { showToast('Account setup incomplete.', 'error'); return; }
    if (isClockedIn) { showToast('Already clocked in!', 'warning'); return; }
    setActionLoading(true);
    const { loc, msg } = await resolveClockLocation();
    if (loc === null) { showToast(msg, 'error'); setActionLoading(false); return; }
    try {
      await svcClockIn(tenant.id, profile.id, tenant, loc.lat !== 0 ? loc : null);
      const inTime = fmtTime12(timeStr(new Date()));
      showToast(`Clocked in at ${inTime}`, 'success');
      presentLocalNotification('Clocked In ✓', `You clocked in at ${inTime}`, { type: 'clock_in' });
      await refresh();
    } catch (err: any) {
      showToast('Clock in failed: ' + err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  }, [profile, tenant, isClockedIn, resolveClockLocation, refresh]);

  const handleClockOut = useCallback(async () => {
    if (!isClockedIn) { showToast('Not clocked in!', 'warning'); return; }
    setActionLoading(true);
    const { loc, msg } = await resolveClockLocation();
    if (loc === null) { showToast(msg, 'error'); setActionLoading(false); return; }
    try {
      const { total } = await svcClockOut(profile!.id, loc.lat !== 0 ? loc : null);
      const worked = fmtDuration(total);
      showToast(`Clocked out. Worked ${worked}`, 'success');
      presentLocalNotification('Clocked Out', `You worked ${worked} today.`, { type: 'clock_out' });
      await refresh();
      maybeAskReview();
    } catch (err: any) {
      showToast('Clock out failed: ' + err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  }, [isClockedIn, profile, resolveClockLocation, refresh]);

  return {
    loading,
    myPunches,
    isClockedIn,
    locationStatus,
    liveClock,
    liveDate,
    timerDisplay,
    timerSeconds,
    actionLoading,
    accessibleOutlets,
    handleClockIn,
    handleClockOut,
    refresh,
  };
}
