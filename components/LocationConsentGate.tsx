import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import { useFeatures } from '@/context/FeatureContext';

const ASKED_KEY_PREFIX = 'crewcore_location_consent_asked_';

/**
 * Renders nothing — asks for foreground, then background, location
 * permission once per employee per install, the moment they're signed in to
 * a tenant with Live Tracking enabled (features.key = 'live_tracking'). This
 * is only the *consent* prompt: whether anything actually gets recorded
 * still depends entirely on employee_tracking_toggles (an admin turning
 * tracking on for this specific person) and being clocked in — see
 * hooks/useLiveTrackingCapture.ts. Asking here means no runtime permission
 * prompt is needed later, at the moment an admin flips that toggle.
 *
 * Every other tenant (Live Tracking not enabled) never sees this prompt.
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
      askedRef.current = true;
      try {
        const fg = await Location.requestForegroundPermissionsAsync();
        // Android builds don't declare background location (Play policy), so
        // only iOS asks for it; Android tracking is foreground-only.
        if (fg.status === 'granted' && Platform.OS === 'ios') {
          // iOS requires foreground granted before background can even be
          // requested; Android 10+ needs the same two-step flow in practice
          // (a combined prompt on first ask, a settings-redirect on retry).
          await Location.requestBackgroundPermissionsAsync();
        }
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
