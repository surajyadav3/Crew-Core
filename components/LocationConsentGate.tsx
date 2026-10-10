import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import { useFeatures } from '@/context/FeatureContext';
import { getMyTrackingToggle } from '@/services/trackingService';

const ASKED_KEY_PREFIX = 'crewcore_location_consent_asked_';

/**
 * Renders nothing — asks for foreground ("While using the app") location
 * permission once per employee per install, the moment a Live-Tracked
 * employee (employee_tracking_toggles on — e.g. Raniwala's B2B SALES) signs
 * in to a tenant with Live Tracking enabled (features.key = 'live_tracking').
 * Only the system permission dialog; no "Allow all the time" is ever asked
 * (see lib/liveTrackingTask.ts). Recording itself still depends on being
 * clocked in — see hooks/useLiveTrackingCapture.ts.
 *
 * Everyone else (not tracked, or Live Tracking not enabled) never sees it.
 */
export default function LocationConsentGate() {
  const { profile, tenant } = useAuth();
  const { isEnabled } = useFeatures();
  const askedRef = useRef(false);

  useEffect(() => {
    if (!profile?.id || !tenant?.id || askedRef.current) return;
    if (!isEnabled('live_tracking')) return;

    const key = `${ASKED_KEY_PREFIX}${profile.id}`;
    let cancelled = false;

    AsyncStorage.getItem(key).then(async (already) => {
      if (already || cancelled) return;
      if (!(await getMyTrackingToggle(profile.id)) || cancelled) return;
      askedRef.current = true;
      try {
        await Location.requestForegroundPermissionsAsync();
      } catch (err) {
        console.error('[CrewCore] location consent request failed:', err);
      } finally {
        if (!cancelled) await AsyncStorage.setItem(key, '1');
      }
    });

    return () => { cancelled = true; };
  }, [profile?.id, tenant?.id, isEnabled]);

  return null;
}
