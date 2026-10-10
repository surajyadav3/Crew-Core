import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFeatures } from '@/context/FeatureContext';
import { getMyTrackingToggle } from '@/services/trackingService';
import { setTrackingContext, startRecording, stopRecording } from '@/lib/liveTrackingTask';

// How often an already-running app re-checks whether an admin just turned
// tracking on/off for this employee — mirrors src/hooks/useLiveTrackingCapture.js's
// TOGGLE_POLL_MS: without this, someone already clocked in with the app open
// before an admin flips their toggle would never start capturing until they
// happened to relaunch. Only polled while clocked in (the feature is
// tenant-wide, so every Raniwala employee runs this hook) and every 5 min,
// not every minute, to keep request load on the shared DB down; returning
// to the app re-checks too.
const TOGGLE_POLL_MS = 5 * 60 * 1000;

// Shared by every mounted copy of the hook (Home and Attendance both mount it
// via useClockInOut), so they make one request between them, not one each.
let toggleCache: { profileId: string; on: boolean; at: number } | null = null;
let toggleInFlight: Promise<boolean> | null = null;

function readToggle(profileId: string): Promise<boolean> {
  if (toggleCache?.profileId === profileId && Date.now() - toggleCache.at < TOGGLE_POLL_MS - 5000) {
    return Promise.resolve(toggleCache.on);
  }
  if (!toggleInFlight) {
    toggleInFlight = getMyTrackingToggle(profileId)
      .then((on) => { toggleCache = { profileId, on, at: Date.now() }; return on; })
      .finally(() => { toggleInFlight = null; });
  }
  return toggleInFlight;
}

const BATTERY_ASKED_KEY = 'crewcore_battery_prompt_shown';

// Module-level so the Home and Attendance screens (which each mount this
// hook) never show the battery prompt twice at once.
let promptInFlight = false;

/**
 * Android battery savers (especially Xiaomi, Vivo, Oppo, Realme) kill
 * foreground services after a while unless the app's battery setting is
 * "Unrestricted". Shown once per install, the first time recording starts.
 */
async function promptBatteryUnrestricted() {
  if (Platform.OS !== 'android') return;
  if (await AsyncStorage.getItem(BATTERY_ASKED_KEY).catch(() => null)) return;
  await AsyncStorage.setItem(BATTERY_ASKED_KEY, '1').catch(() => {});
  const ok = await new Promise<boolean>((resolve) => {
    Alert.alert(
      'Battery setting',
      'Open CrewCore’s settings → Battery and choose “Unrestricted” (or “No restrictions”) so your '
        + 'clock-in keeps running on the road. On Xiaomi, Vivo, Oppo and Realme phones also turn on “Autostart”.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Open settings', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
  if (ok) Linking.openSettings().catch(() => {});
}

/**
 * Records this employee's location while Live Tracking is on for them
 * (employee_tracking_toggles — Raniwala's B2B SALES field staff) and they're
 * clocked in. The recording itself lives in lib/liveTrackingTask.ts so it
 * keeps going with the app in the background; this hook only decides when to
 * start/stop it. It uses the normal "While using the app" permission already
 * asked at clock-in — no "Allow all the time", no tracking disclosure.
 * Silently does nothing for every tenant/employee this premium, opt-in
 * feature hasn't been turned on for.
 *
 * `isClockedIn` is null while today's punches are still loading — nothing is
 * started or stopped on that placeholder, so opening the app doesn't briefly
 * stop a background recording that's already running.
 */
export function useLiveTrackingCapture({ profile, tenant, isClockedIn }: {
  profile: { id: string; outlet_id?: string | null } | null;
  tenant: { id: string } | null;
  isClockedIn: boolean | null;
}) {
  const { isEnabled } = useFeatures();
  // null until the first toggle check answers.
  const [trackingOn, setTrackingOn] = useState<boolean | null>(null);
  const featureOn = isEnabled('live_tracking');

  useEffect(() => {
    if (profile?.id && tenant?.id) {
      setTrackingContext({ profileId: profile.id, tenantId: tenant.id, outletId: profile.outlet_id || null });
    }
  }, [profile?.id, profile?.outlet_id, tenant?.id]);

  // Bumped each time the app returns to the foreground — including right after
  // a system permission dialog or the Settings screen closes — so the start
  // logic below gets another go once foreground/background permission changed.
  const [resumeTick, setResumeTick] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setResumeTick((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  // The toggle only matters while clocked in, so it's only read then: on
  // clock-in / app open, on returning to the app, and every TOGGLE_POLL_MS.
  const clockedIn = isClockedIn === true;
  useEffect(() => {
    // Feature off (or feature flags not loaded yet) stays "unknown" rather
    // than false, so a slow flag load at app launch can't stop a recording
    // that's already running in the background.
    if (!profile?.id || !featureOn) { setTrackingOn(null); return; }
    if (!clockedIn) return;
    let cancelled = false;
    const checkToggle = () => {
      readToggle(profile.id).then((on) => { if (!cancelled) setTrackingOn(on); });
    };
    checkToggle();
    const intervalId = setInterval(checkToggle, TOGGLE_POLL_MS);
    return () => { cancelled = true; clearInterval(intervalId); };
  }, [profile?.id, featureOn, clockedIn, resumeTick]);

  // Starts/stops recording purely off (trackingOn, isClockedIn) — no unmount
  // cleanup on purpose: tracking must outlive any one screen (and the app
  // itself), tied only to clocking out or tracking being switched off.
  useEffect(() => {
    if (!profile?.id || !tenant?.id || isClockedIn === null) return;
    // Clocked out: stop without needing the toggle (stopRecording is local only).
    if (!isClockedIn) { stopRecording(); return; }
    if (trackingOn === null) return;
    if (!trackingOn) { stopRecording(); return; }

    (async () => {
      const mode = await startRecording();
      if (mode !== 'background' || promptInFlight) return;
      promptInFlight = true;
      try {
        await promptBatteryUnrestricted();
      } finally {
        promptInFlight = false;
      }
    })();
  }, [trackingOn, isClockedIn, profile?.id, tenant?.id, resumeTick]);

  return { trackingOn: !!trackingOn };
}
