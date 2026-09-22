import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { useFeatures } from '@/context/FeatureContext';
import { getMyTrackingToggle, insertPing } from '@/services/trackingService';
import { todayStr } from '@/lib/helpers';

const LOCATION_TASK_NAME = 'crewcore-live-tracking';

// How often an already-running app re-checks whether an admin just turned
// tracking on/off for this employee — mirrors src/hooks/useLiveTrackingCapture.js's
// TOGGLE_POLL_MS exactly, same reasoning: without this, someone already
// clocked in with the app open before an admin flips their toggle would
// never start capturing until they happened to relaunch.
const TOGGLE_POLL_MS = 60000;

// TaskManager.defineTask runs outside React (it can survive the JS context
// being torn down and restarted by the OS), so it can't read hook state
// directly — this module-level ref is the standard Expo pattern for handing
// a background task whatever context it needs, kept in sync by the hook
// below every time the signed-in employee/tenant changes.
let activeContext: { profileId: string; tenantId: string; outletId: string | null } | null = null;

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error || !data || !activeContext) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const last = locations?.[locations.length - 1];
  if (!last) return;

  // Re-checked on every delivered fix, not just once at start — an admin
  // turning tracking off mid-shift stops new pings within one fix, without
  // needing the app foregrounded to notice.
  const stillOn = await getMyTrackingToggle(activeContext.profileId).catch(() => false);
  if (!stillOn) return;

  await insertPing(
    activeContext.tenantId, activeContext.profileId, activeContext.outletId,
    last.coords.latitude, last.coords.longitude, last.coords.accuracy,
    todayStr()
  ).catch((err) => console.error('[live-tracking] ping insert failed:', err));
});

/**
 * Records this employee's location while Live Tracking is on for them
 * (employee_tracking_toggles) and they're clocked in — same on-the-clock
 * lifecycle as src/hooks/useLiveTrackingCapture.js, but backed by a real
 * native background task (expo-location + expo-task-manager) instead of a
 * foreground-only watchPosition, so the trail continues while the app is
 * backgrounded or (Android) fully closed. Silently does nothing for every
 * tenant/employee this premium, opt-in feature hasn't been turned on for.
 *
 * Never requests permission itself — LocationConsentGate already asks once
 * at login for any tenant with Live Tracking enabled; if that was denied,
 * this just never starts (checked via getBackgroundPermissionsAsync below).
 */
export function useLiveTrackingCapture({ profile, tenant, isClockedIn }: {
  profile: { id: string; outlet_id?: string | null } | null;
  tenant: { id: string } | null;
  isClockedIn: boolean;
}) {
  const { isEnabled } = useFeatures();
  const [trackingOn, setTrackingOn] = useState(false);
  const featureOn = isEnabled('live_tracking');

  useEffect(() => {
    if (!profile?.id || !featureOn) { setTrackingOn(false); return; }
    let cancelled = false;
    const checkToggle = () => {
      getMyTrackingToggle(profile.id).then((on) => { if (!cancelled) setTrackingOn(on); });
    };
    checkToggle();
    const intervalId = setInterval(checkToggle, TOGGLE_POLL_MS);
    return () => { cancelled = true; clearInterval(intervalId); };
  }, [profile?.id, featureOn]);

  useEffect(() => {
    activeContext = (profile?.id && tenant?.id)
      ? { profileId: profile.id, tenantId: tenant.id, outletId: profile.outlet_id || null }
      : null;
  }, [profile?.id, profile?.outlet_id, tenant?.id]);

  // Starts/stops the background task purely off (trackingOn, isClockedIn)
  // state — deliberately has no unmount cleanup that stops it, since
  // useClockInOut (and therefore this hook) mounts once per screen (Home +
  // Attendance simultaneously); tracking must keep running when one of those
  // screens unmounts, tied only to actually clocking out.
  useEffect(() => {
    if (!trackingOn || !profile?.id || !tenant?.id) return;

    (async () => {
      const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
      if (isClockedIn && !alreadyStarted) {
        const fg = await Location.getForegroundPermissionsAsync();
        const bg = await Location.getBackgroundPermissionsAsync();
        if (fg.status !== 'granted' || bg.status !== 'granted') return;
        await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 45000,
          distanceInterval: 0,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'CrewCore',
            notificationBody: 'Recording your location while you’re clocked in.',
          },
        }).catch((err) => console.error('[live-tracking] startLocationUpdatesAsync failed:', err));
      } else if (!isClockedIn && alreadyStarted) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => {});
      }
    })();
  }, [trackingOn, isClockedIn, profile?.id, tenant?.id]);

  return { trackingOn };
}
