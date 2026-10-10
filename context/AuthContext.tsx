import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  largeSecureStore, allowSessionRemoval, readSessionBackup, writeSessionBackup, hasStoredValue,
} from '@/lib/secureStorage';
import { sendOtp as svcSendOtp, verifyOtp as svcVerifyOtp, resolveLoginEmail } from '@/services/otpService';
import { registerForPush } from '@/services/pushService';
import { presentLocalNotification } from '@/lib/pushNotifications';
import { resetLiveTracking } from '@/lib/liveTrackingTask';

type Profile = {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  email: string;
  department?: string;
  designation?: string;
  join_date?: string;
  ctc?: number;
  tenant_id: string;
  tenants?: Tenant;
  [key: string]: any;
};

type Tenant = {
  id: string;
  company_name: string;
  shift_start?: string;
  late_threshold?: number;
  geofence_lat?: number;
  geofence_lng?: number;
  geofence_radius?: number;
  min_half_day_hours?: number;
  min_full_day_hours?: number;
  allow_any_outlet_clockin?: boolean;
  [key: string]: any;
};

/**
 * 'unknown' — not loaded yet (or couldn't be loaded, e.g. offline, and nothing cached)
 * 'ready'   — profile loaded (from the server or the on-device cache)
 * 'missing' — the server confirmed this account has no profile row yet → /register
 */
export type ProfileStatus = 'unknown' | 'ready' | 'missing';

type AuthContextType = {
  user: any;
  profile: Profile | null;
  tenant: Tenant | null;
  loading: boolean;
  profileStatus: ProfileStatus;
  signIn: (identifier: string, password: string) => Promise<any>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<any>;
  sendOtp: (identifier: string, isSignup?: boolean) => Promise<any>;
  verifyOtp: (identifier: string, token: string, isSignup?: boolean, password?: string, firstName?: string, lastName?: string) => Promise<any>;
};

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

// Last successfully loaded profile (with its tenant), encrypted at rest with
// the same adapter as the session. Lets a returning user land straight in the
// app — even offline, even before the server answers — like any app that
// keeps you signed in, instead of a spinner or the register screen.
const PROFILE_CACHE_KEY = 'crewcore-profile-cache';

async function loadCachedProfile(userId: string): Promise<Profile | null> {
  try {
    const raw = await largeSecureStore.getItem(PROFILE_CACHE_KEY);
    const cached = raw ? JSON.parse(raw) : null;
    return cached?.id === userId ? cached : null;
  } catch {
    return null;
  }
}

function saveCachedProfile(p: Profile | null) {
  const op = p ? largeSecureStore.setItem(PROFILE_CACHE_KEY, JSON.stringify(p)) : largeSecureStore.removeItem(PROFILE_CACHE_KEY);
  op.catch((err) => console.warn('[CrewCore] profile cache write skipped:', err));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The saved session straight from storage — no network, no refresh. When a
 * session IS saved but can't be decrypted right now (Keychain/Keystore read
 * hiccup), the read is retried briefly before giving up. A readable session
 * also refreshes the refresh-token backup (covers installs saved before the
 * backup existed).
 */
async function readStoredSession(): Promise<any | null> {
  const storageKey = (supabase.auth as any).storageKey as string;
  for (const wait of [0, 300, 1000]) {
    if (wait) {
      if (!(await hasStoredValue(storageKey))) return null;
      await sleep(wait);
    }
    try {
      const raw = await largeSecureStore.getItem(storageKey);
      const stored = raw ? JSON.parse(raw) : null;
      if (stored?.user?.id && stored?.refresh_token) {
        writeSessionBackup(raw!);
        return stored;
      }
    } catch {
      // fall through to the next attempt
    }
  }
  return null;
}

type RestoreResult =
  | { status: 'none' }
  | { status: 'restored'; user: any }
  | { status: 'offline'; userId: string }
  | { status: 'rejected'; message: string };

/**
 * The saved session couldn't be read at all — sign back in silently with the
 * backed-up refresh token (see secureStorage rule 6). supabase-js saves the
 * new session and emits TOKEN_REFRESHED on success.
 */
async function restoreFromBackup(): Promise<RestoreResult> {
  const backup = await readSessionBackup();
  if (!backup) return { status: 'none' };
  try {
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: backup.refreshToken });
    if (data?.session?.user) return { status: 'restored', user: data.session.user };
    if (!error || isAuthRetryableFetchError(error)) return { status: 'offline', userId: backup.userId };
    return { status: 'rejected', message: error.message };
  } catch {
    return { status: 'offline', userId: backup.userId };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('unknown');

  // Who the app currently considers signed in — lets a slow fetchProfile()
  // drop its result if the user changed meanwhile, without calling getSession()
  // (which needs the network to refresh an expired token, so it "failed" the
  // guard whenever the phone was offline).
  const userIdRef = useRef<string | null>(null);
  // True only while the user themselves is signing out — any other SIGNED_OUT
  // event is treated as "re-check", not "log out".
  const explicitSignOutRef = useRef(false);
  const validatingRef = useRef<Promise<void> | null>(null);

  const applyUser = useCallback((u: any | null) => {
    userIdRef.current = u?.id ?? null;
    setUser(u);
  }, []);

  const clearLocalState = useCallback(() => {
    userIdRef.current = null;
    setUser(null);
    setProfile(null);
    setTenant(null);
    setProfileStatus('unknown');
  }, []);

  const fetchProfile = useCallback(async (userId: string) => {
    if (!userId) return null;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, tenants(*)')
        .eq('id', userId)
        .maybeSingle();

      // A failed fetch (offline, timeout) keeps whatever profile we already
      // have — it must never look like "this account has no profile".
      if (error) { console.warn('fetchProfile error:', error.message); return null; }
      if (userIdRef.current !== userId) return null;

      if (data) {
        setProfile(data);
        setTenant(data.tenants);
        setProfileStatus('ready');
        saveCachedProfile(data);
      } else {
        setProfile(null);
        setTenant(null);
        setProfileStatus('missing');
      }
      return data;
    } catch (err) {
      console.warn('fetchProfile exception:', err);
      return null;
    }
  }, []);

  /** Sign out for real: clears the saved session, the profile cache and state. */
  const hardSignOut = useCallback(async (reason: string) => {
    console.warn('[CrewCore] signing out:', reason);
    explicitSignOutRef.current = true;
    try {
      await allowSessionRemoval(() => supabase.auth.signOut({ scope: 'local' }));
    } catch (err) {
      console.error('[CrewCore] local sign-out error:', err);
    } finally {
      explicitSignOutRef.current = false;
      // Stop Live Tracking and forget this employee's context and any unsent
      // fixes, so a signed-out phone never keeps recording in the background.
      resetLiveTracking().catch(() => {});
      saveCachedProfile(null);
      clearLocalState();
    }
  }, [clearLocalState]);

  /**
   * Confirms the saved session with the server (refreshing it if expired).
   * Only a definite rejection from the auth server signs the user out; a
   * network problem keeps them signed in and is retried on the next resume.
   * A first rejection is re-checked once after a short pause: if another JS
   * runtime (the background task) rotated the refresh token a moment ago, the
   * fresh one is in storage by then and the retry succeeds.
   */
  const validateSession = useCallback(() => {
    if (validatingRef.current) return validatingRef.current;
    const run = (async () => {
      for (let attempt = 1; attempt <= 6; attempt++) {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (session?.user) {
          applyUser(session.user);
          await fetchProfile(session.user.id);
          return;
        }
        const stored = await readStoredSession();
        if (!stored) {
          // The saved session is gone or unreadable — try the refresh-token
          // backup before treating the user as signed out.
          const restored = await restoreFromBackup();
          if (restored.status === 'restored') {
            applyUser(restored.user);
            await fetchProfile(restored.user.id);
            return;
          }
          if (restored.status === 'none') {
            // Nothing saved at all (never signed in, or signed out on this
            // device) — genuinely signed out.
            if (userIdRef.current) clearLocalState();
            return;
          }
          if (restored.status === 'offline') {
            // Can't reach the server — stay signed in and retry.
            if (attempt === 6) return;
            await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
            continue;
          }
          // The server refused the backed-up refresh token.
          if (attempt === 1) { await sleep(1500); continue; }
          await hardSignOut(`session rejected by server: ${restored.message}`);
          return;
        }
        if (!error || isAuthRetryableFetchError(error)) {
          // Offline / flaky network, or storage briefly unreadable — stay
          // signed in, back off, and try again.
          if (attempt === 6) return;
          await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
          continue;
        }
        // The server answered and refused the refresh token.
        if (attempt === 1) { await sleep(1500); continue; }
        await hardSignOut(`session rejected by server: ${error.message}`);
        return;
      }
    })().finally(() => { validatingRef.current = null; });
    validatingRef.current = run;
    return run;
  }, [applyUser, fetchProfile, hardSignOut, clearLocalState]);

  useEffect(() => {
    let mounted = true;

    // Only the visible app owns the refresh ticker (see lib/supabase.ts).
    if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();

    const init = async () => {
      // 1. Instant: restore the saved session + cached profile with no network,
      //    so a returning user lands straight in the app.
      const stored = await readStoredSession();
      if (!mounted) return;
      let startUser = stored?.user ?? null;
      if (!stored) {
        // Session unreadable — restore it from the refresh-token backup before
        // showing anything. Offline (or no answer within 8s): show the app
        // from the cached profile and let validateSession() keep retrying.
        // Only user.id is read from `user` anywhere in the app, and the real
        // user object replaces this stand-in once the session is restored.
        const restored = await Promise.race([
          restoreFromBackup(),
          sleep(8000).then(async (): Promise<RestoreResult> => {
            const backup = await readSessionBackup();
            return backup ? { status: 'offline', userId: backup.userId } : { status: 'none' };
          }),
        ]);
        if (!mounted) return;
        if (restored.status === 'restored') startUser = restored.user;
        else if (restored.status === 'offline') startUser = { id: restored.userId };
      }
      if (startUser) {
        applyUser(startUser);
        const cached = await loadCachedProfile(startUser.id);
        if (!mounted) return;
        if (cached) {
          setProfile(cached);
          setTenant(cached.tenants ?? null);
          setProfileStatus('ready');
        }
      }
      setLoading(false);

      // 2. In the background: confirm with the server and refresh the profile.
      await validateSession();
    };

    init().catch((err) => {
      console.error('[CrewCore] Auth init error:', err);
      if (mounted) setLoading(false);
    });

    // Don't call supabase.auth.* synchronously inside onAuthStateChange — the
    // auth client can still hold its internal lock while dispatching, so work
    // is deferred with setTimeout.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      setTimeout(async () => {
        if (!mounted) return;
        // Only the fresh-login path below flips `loading` on, so only it
        // flips it off. INITIAL_SESSION used to end `loading` here before
        // init() had restored the saved user — a flash of the login screen.
        let startedLoading = false;
        try {
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
            if (!session?.user) return;
            const isNewUser = userIdRef.current !== session.user.id;
            applyUser(session.user);
            if (isNewUser) {
              // Fresh login: keep `loading` true until the profile settles so
              // login.tsx doesn't route on a stale null profile.
              startedLoading = true;
              setLoading(true);
              setProfileStatus('unknown');
              await fetchProfile(session.user.id);
            } else if (event === 'TOKEN_REFRESHED') {
              fetchProfile(session.user.id);
            }
          } else if (event === 'SIGNED_OUT') {
            if (explicitSignOutRef.current) {
              clearLocalState();
            } else {
              // supabase-js gave up on a refresh — re-check instead of
              // dropping the user to the login screen.
              validateSession();
            }
          }
        } catch (err) {
          console.error('[CrewCore] Auth state change error:', err);
        } finally {
          if (mounted && startedLoading) setLoading(false);
        }
      }, 0);
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, [applyUser, fetchProfile, validateSession, clearLocalState]);

  // On every return to the foreground: re-confirm the session (catches up after
  // being offline) and resync the profile. The realtime channels below ride a
  // websocket the OS suspends while backgrounded, so changes made meanwhile
  // (role, leave decision, admin edit) only arrive through this refetch.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && userIdRef.current) validateSession();
    });
    return () => sub.remove();
  }, [validateSession]);

  // Register this device for push notifications once we know who's signed in.
  useEffect(() => {
    if (!profile?.id || !profile?.tenant_id) return;
    registerForPush(profile.id, profile.tenant_id).catch((err) =>
      console.error('[CrewCore] registerForPush error:', err)
    );
  }, [profile?.id, profile?.tenant_id]);

  // Listen for leave status changes and show a system notification
  useEffect(() => {
    if (!profile?.id) return;

    const channel = supabase
      .channel(`leave-status-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'leave_requests', filter: `profile_id=eq.${profile.id}` },
        (payload) => {
          const newStatus = payload.new?.status;
          const oldStatus = payload.old?.status;
          if (!newStatus || newStatus === oldStatus) return;
          const leaveType = payload.new?.leave_type || 'Leave';
          if (newStatus === 'Approved') {
            presentLocalNotification('Leave Approved ✅', `Your ${leaveType} request has been approved.`, { type: 'leave_approved' });
          } else if (newStatus === 'Rejected') {
            presentLocalNotification('Leave Rejected ❌', `Your ${leaveType} request was not approved.`, { type: 'leave_rejected' });
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile?.id]);

  // Live geofence sync: when an admin updates this tenant's default clock-in
  // location on the web (Settings → Attendance & Geofencing), reflect it here
  // immediately instead of waiting for the next sign-in/profile refetch — no
  // app update or manual refresh needed. Outlet-level overrides are synced
  // separately in useClockInOut, where accessibleOutlets already lives.
  useEffect(() => {
    if (!tenant?.id) return;

    const channel = supabase
      .channel(`geofence-${tenant.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tenants', filter: `id=eq.${tenant.id}` },
        (payload) => {
          setTenant((prev) => (prev ? { ...prev, ...payload.new } : prev));
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenant?.id]);

  const signIn = useCallback(async (identifier: string, password: string) => {
    const email = await resolveLoginEmail(identifier);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }, []);

  // User tapped Sign out. Tries to end the session server-side too, but the
  // local session is always cleared — previously an offline sign-out left it
  // saved (supabase-js skips local removal when the server call fails), so the
  // user was silently signed back in on the next launch.
  const signOut = useCallback(async () => {
    explicitSignOutRef.current = true;
    try {
      await allowSessionRemoval(async () => {
        // scope 'local' revokes only this device's session server-side — the
        // default ('global') also killed the same account's website sessions.
        await supabase.auth.signOut({ scope: 'local' }).catch((err) => console.warn('[CrewCore] server sign-out failed:', err));
        await supabase.auth.signOut({ scope: 'local' });
      });
    } catch (err) {
      console.error('[CrewCore] signOut error (clearing local state anyway):', err);
    } finally {
      explicitSignOutRef.current = false;
      // Stop Live Tracking and forget this employee's context and any unsent
      // fixes, so a signed-out phone never keeps recording in the background.
      resetLiveTracking().catch(() => {});
      saveCachedProfile(null);
      clearLocalState();
    }
  }, [clearLocalState]);

  const refreshProfile = useCallback(() => {
    if (user?.id) return fetchProfile(user.id);
    return Promise.resolve(null);
  }, [user, fetchProfile]);

  const sendOtp = useCallback((identifier: string, isSignup = false) => svcSendOtp(identifier, isSignup), []);
  const verifyOtp = useCallback(
    (identifier: string, token: string, isSignup = false, password?: string, firstName?: string, lastName?: string) =>
      svcVerifyOtp(identifier, token, isSignup, password, firstName, lastName),
    []
  );

  const value = useMemo(() => ({
    user, profile, tenant, loading, profileStatus,
    signIn, signOut, refreshProfile, sendOtp, verifyOtp,
  }), [user, profile, tenant, loading, profileStatus, signIn, signOut, refreshProfile, sendOtp, verifyOtp]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
