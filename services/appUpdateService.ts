import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase';

export const ANDROID_PACKAGE = 'com.crewcore.app';
export const IOS_APP_ID = '6805603247';

export const STORE_URL = Platform.OS === 'ios'
  ? `https://apps.apple.com/app/id${IOS_APP_ID}`
  : `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
export const STORE_DEEP_LINK = Platform.OS === 'ios'
  ? `itms-apps://apps.apple.com/app/id${IOS_APP_ID}`
  : `market://details?id=${ANDROID_PACKAGE}`;

export const currentAppVersion = (): string => Constants.expoConfig?.version ?? '0.0.0';

/** Compares dotted versions numerically: '1.1.10' > '1.1.9'. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export interface AppUpdateInfo {
  latestVersion: string;
  notes: string | null;
  forced: boolean;
}

/**
 * The published release for this platform (the app_releases table, bumped
 * after each store release). Null when this install is already current, on
 * web, or when the check fails — a failed check never blocks the app.
 */
export async function checkForAppUpdate(): Promise<AppUpdateInfo | null> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
  const { data, error } = await supabase
    .from('app_releases')
    .select('latest_version, min_version, notes')
    .eq('platform', Platform.OS)
    .maybeSingle();
  if (error || !data?.latest_version) return null;

  const current = currentAppVersion();
  if (compareVersions(current, data.latest_version) >= 0) return null;
  return {
    latestVersion: data.latest_version,
    notes: data.notes,
    forced: !!data.min_version && compareVersions(current, data.min_version) < 0,
  };
}
