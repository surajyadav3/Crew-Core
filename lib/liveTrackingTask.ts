import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { insertPings, shouldRecordLocation, type PingRow } from '@/services/trackingService';
import { todayStr, dateStr, calculateDistance } from '@/lib/helpers';

/**
 * Live Tracking recorder: the part that has to keep working with the app
 * backgrounded or swiped away. Imported at the very top of app/_layout.tsx so
 * the task is defined in every JS runtime the OS starts, including the
 * headless one Android spins up to redeliver fixes after the app's process
 * was killed. A task defined only inside a screen's module would not exist in
 * that runtime, and the fixes would be silently dropped.
 *
 * Only the normal "While using the app" permission is used — no "Allow all
 * the time", no background-location disclosure. That works because recording
 * is started from the Clock In tap (app on screen), as a user-initiated
 * foreground service:
 * Android: a location foreground service (persistent "On duty" notification,
 * required by Android) with killServiceOnDestroy false, so it keeps going with
 * the app in the background or swiped from recents. It does NOT survive
 * "Force stop" in system settings, and aggressive OEM battery savers (Xiaomi,
 * Vivo, Oppo, Realme) can still stop it unless battery is set to Unrestricted.
 * iOS: "While using" + the location background mode (blue location pill);
 * iOS stops delivering fixes once the user swipes the app away.
 */

export const LOCATION_TASK_NAME = 'crewcore-live-tracking';

const CONTEXT_KEY = 'crewcore_live_tracking_ctx';
const QUEUE_KEY = 'crewcore_live_tracking_queue';

// OS asks for a GPS (Accuracy.High) fix this often while recording — Balanced
// gave Wi-Fi/cell estimates on Android, too rough for a route and distance.
const FIX_INTERVAL_MS = 45000;
// A fix is only written when the phone moved at least this far since the last
// written one, or HEARTBEAT_MS has passed — someone sat at a client's shop for
// an hour costs 12 rows, not 80. Matches LiveTrackingPage's 30 m "standing" radius.
const MIN_MOVE_M = 30;
const HEARTBEAT_MS = 5 * 60 * 1000;
// How often the recorder asks the DB whether it should still be recording
// (toggle on + still clocked in; see live_tracking_should_record).
const RECHECK_MS = 5 * 60 * 1000;
// A fix vaguer than this is a Wi-Fi/mobile-network estimate, not GPS — it can
// sit hundreds of metres (or, with no signal, cities) away from the phone and
// would draw a false route and distance, so it's not written.
const MAX_ACCURACY_M = 100;
// Fixes held while offline (field staff lose signal); oldest dropped past this.
const MAX_QUEUE = 500;
const INSERT_BATCH = 200;

export type TrackingContext = { profileId: string; tenantId: string; outletId: string | null };

let ctx: TrackingContext | null = null;
let lastWritten: { lat: number; lng: number; at: number } | null = null;
let lastCheckAt = 0;
let foregroundSub: Location.LocationSubscription | null = null;
let foregroundStarting = false;
// Fixes are handled one batch at a time so the offline queue in AsyncStorage
// is never read and rewritten by two batches at once.
let chain: Promise<void> = Promise.resolve();

/** Remembers who is signed in, in memory and on disk for a headless restart. */
export async function setTrackingContext(next: TrackingContext | null) {
  ctx = next;
  try {
    if (next) await AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify(next));
    else await AsyncStorage.multiRemove([CONTEXT_KEY, QUEUE_KEY]);
  } catch {}
}

async function loadContext(): Promise<TrackingContext | null> {
  if (ctx) return ctx;
  try {
    const raw = await AsyncStorage.getItem(CONTEXT_KEY);
    ctx = raw ? JSON.parse(raw) : null;
  } catch {
    ctx = null;
  }
  return ctx;
}

async function writeRows(rows: PingRow[]) {
  let queued: PingRow[] = [];
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    queued = raw ? JSON.parse(raw) : [];
  } catch {}
  const all = [...queued, ...rows];
  if (!all.length) return;

  let sent = 0;
  while (sent < all.length) {
    const { error } = await insertPings(all.slice(sent, sent + INSERT_BATCH));
    if (error) break;
    sent += INSERT_BATCH;
  }
  const remaining = all.slice(sent).slice(-MAX_QUEUE);
  try {
    if (remaining.length) await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    else if (queued.length) await AsyncStorage.removeItem(QUEUE_KEY);
  } catch {}
}

async function handleFixes(locations: Location.LocationObject[]) {
  const c = await loadContext();
  if (!c) { await stopRecording(); return; }

  if (Date.now() - lastCheckAt >= RECHECK_MS) {
    const should = await shouldRecordLocation(todayStr());
    // null = the check itself failed (offline): keep recording and queueing.
    if (should !== null) lastCheckAt = Date.now();
    if (should === false) { await stopRecording(); return; }
  }

  const rows: PingRow[] = [];
  for (const loc of locations) {
    const at = loc.timestamp || Date.now();
    const { latitude: lat, longitude: lng, accuracy } = loc.coords;
    if (accuracy != null && accuracy > MAX_ACCURACY_M) continue;
    if (lastWritten
        && calculateDistance(lastWritten.lat, lastWritten.lng, lat, lng) < MIN_MOVE_M
        && at - lastWritten.at < HEARTBEAT_MS) continue;
    lastWritten = { lat, lng, at };
    rows.push({
      tenant_id: c.tenantId,
      employee_id: c.profileId,
      outlet_id: c.outletId,
      lat,
      lng,
      accuracy: accuracy ?? null,
      recorded_at: new Date(at).toISOString(),
      recorded_date: dateStr(new Date(at)),
    });
  }
  await writeRows(rows);
}

function enqueueFixes(locations: Location.LocationObject[]) {
  chain = chain
    .then(() => handleFixes(locations))
    .catch((err) => console.error('[live-tracking] handling fixes failed:', err));
  return chain;
}

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  if (locations?.length) await enqueueFixes(locations);
});

async function startForegroundWatch() {
  if (foregroundSub || foregroundStarting) return;
  foregroundStarting = true;
  try {
    foregroundSub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: FIX_INTERVAL_MS, distanceInterval: 0 },
      (loc) => { enqueueFixes([loc]); },
    );
  } catch (err) {
    console.error('[live-tracking] watchPositionAsync failed:', err);
  } finally {
    foregroundStarting = false;
  }
}

function stopForegroundWatch() {
  foregroundSub?.remove();
  foregroundSub = null;
}

export async function isBackgroundRecording() {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
}

/**
 * Starts recording for the signed-in employee, who the caller has just
 * confirmed is tracked and clocked in. Needs only "While using the app"
 * permission: the foreground service keeps recording in the background once
 * started. Android only lets it start while the app is on screen, so if that
 * fails (e.g. called from the background) a watcher records while the app is
 * open and the next foreground resume retries. Returns which one is running.
 */
export async function startRecording(): Promise<'background' | 'foreground' | 'none'> {
  const fg = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (fg?.status !== 'granted') return 'none';
  lastCheckAt = Date.now();

  if (await isBackgroundRecording()) { stopForegroundWatch(); return 'background'; }
  try {
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.High,
      timeInterval: FIX_INTERVAL_MS,
      distanceInterval: 0,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Other,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'CrewCore — On duty',
        notificationBody: 'You’re clocked in. This stops when you clock out.',
        notificationColor: '#6C5CE7',
        killServiceOnDestroy: false,
      },
    });
    stopForegroundWatch();
    return 'background';
  } catch (err) {
    console.error('[live-tracking] startLocationUpdatesAsync failed:', err);
    await startForegroundWatch();
    return 'foreground';
  }
}

export async function stopRecording() {
  stopForegroundWatch();
  lastWritten = null;
  lastCheckAt = 0;
  if (await isBackgroundRecording()) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => {});
  }
}

/** Sign-out: stop recording and forget this employee and any unsent fixes. */
export async function resetLiveTracking() {
  await stopRecording();
  await setTrackingContext(null);
}
