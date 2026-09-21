import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { AppState } from 'react-native';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { sendOtp as svcSendOtp, verifyOtp as svcVerifyOtp, resolveLoginEmail } from '@/services/otpService';
import { registerForPush } from '@/services/pushService';
import { presentLocalNotification } from '@/lib/pushNotifications';

type Profile = {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  email: string;
  department?: string;
  designation?: string;
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

type AuthContextType = {
  user: any;
  profile: Profile | null;
  tenant: Tenant | null;
  loading: boolean;
  signIn: (identifier: string, password: string) => Promise<any>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<any>;
  sendOtp: (identifier: string, isSignup?: boolean) => Promise<any>;
  verifyOtp: (identifier: string, token: string, isSignup?: boolean, password?: string, firstName?: string, lastName?: string) => Promise<any>;
};

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    if (!userId) return null;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, tenants(*)')
        .eq('id', userId)
        .maybeSingle();

      if (error) { console.error('fetchProfile error:', error.message); return null; }

      const { data: { session: current } } = await supabase.auth.getSession();
      if (current?.user?.id !== userId) return null;

      if (data) {
        setProfile(data);
        setTenant(data.tenants);
      } else {
        setProfile(null);
        setTenant(null);
      }
      return data;
    } catch (err) {
      console.error('fetchProfile exception:', err);
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    // A cold-launch getSession() that needs to refresh an expired token requires
    // a real network round-trip, and phones routinely reopen an app in the first
    // second or two of reconnecting Wi-Fi/cell after being locked — exactly when
    // that request is most likely to fail with a transient network error. This
    // was the actual auto-logout bug: supabase-js's getSession() doesn't throw on
    // a failed refresh, it *resolves* with `{ session: null, error }` once its own
    // internal retry/cooldown gives up — including for a plain network blip, not
    // just a genuinely dead refresh token. The old code only checked `session`,
    // never `error`, so it read that resolved null as "logged out" and never
    // tried again, stranding the user on the login screen for the rest of that
    // app session even though nothing about their login had actually expired.
    // Retrying here (and only for retryable errors — isAuthRetryableFetchError
    // excludes a genuinely invalid/expired refresh token) keeps the user signed
    // in through exactly the kind of blip that was causing this.
    const getSessionWithRetry = async (attempt = 1): Promise<{ session: any }> => {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (session || !error) return { session };
      if (isAuthRetryableFetchError(error) && attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** (attempt - 1), 8000)));
        return getSessionWithRetry(attempt + 1);
      }
      throw error;
    };

    const init = async () => {
      // Generous on purpose: after the app has been closed for days the stored
      // access token is guaranteed expired, so getSession() has to do a real
      // network round-trip to refresh it before resolving. A short timeout here
      // races ahead of that refresh on a slow connection and flashes the user
      // to the login screen even though their session is still valid. This is
      // purely a UI fallback (so the spinner doesn't hang forever) — it doesn't
      // touch `user`, so if the retrying getSession() above succeeds after this
      // fires, login.tsx's own effect still redirects the user straight back in.
      const timeoutId = setTimeout(() => { if (mounted) setLoading(false); }, 20000);
      try {
        const { session } = await getSessionWithRetry();
        if (!mounted) return;
        if (session?.user) {
          setUser(session.user);
          await fetchProfile(session.user.id);
        }
      } catch (err) {
        console.error('[CrewCore] Auth init error (giving up after retries):', err);
      } finally {
        clearTimeout(timeoutId);
        if (mounted) setLoading(false);
      }
    };

    init().catch((err) => console.error('[CrewCore] Auth init unhandled:', err));

    // Supabase's own React Native guidance: don't call supabase.auth.* methods
    // synchronously from inside the onAuthStateChange callback — the auth
    // client can still be holding an internal lock while dispatching the
    // event, and fetchProfile calls supabase.auth.getSession(), so doing it
    // inline risks the callback hanging forever (loading never clears, every
    // gated screen stuck on its spinner). Deferring via setTimeout avoids
    // that, while still being `await`ed here so callers below can keep
    // `loading` true until the deferred fetch actually resolves, not just
    // until this handler returns.
    const deferredFetchProfile = (userId: string) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          (mounted ? fetchProfile(userId) : Promise.resolve())
            .catch((e) => console.error('[CrewCore] fetchProfile error:', e))
            .finally(resolve);
        }, 0);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      try {
        if (event === 'SIGNED_IN') {
          if (session?.user) {
            // Keep `loading` true until the profile fetch settles — screens
            // like login.tsx redirect the instant `user` is truthy, and
            // without this they briefly route on a stale null `profile`
            // (flashing the "I am a Founder / HR" workspace picker) before
            // self-correcting once the fetch actually resolves.
            setLoading(true);
            setUser(session.user);
            await deferredFetchProfile(session.user.id);
          }
        } else if (event === 'TOKEN_REFRESHED') {
          if (session?.user) {
            setUser(session.user);
            await deferredFetchProfile(session.user.id);
          }
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setProfile(null);
          setTenant(null);
        }
      } catch (err) {
        console.error('[CrewCore] Auth state change error:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, [fetchProfile]);

  // Resync profile/tenant on foreground resume. The realtime channels below
  // (leave-status, geofence) ride a websocket the OS suspends while
  // backgrounded, so a change made elsewhere during that time — a role
  // change, a leave decision, an admin edit — doesn't arrive as an event once
  // the socket reconnects. Re-fetching on 'active' instead of waiting for the
  // next sign-in makes reopening the app after any length of time behave the
  // same as a fresh load: whatever's true on the server right now.
  useEffect(() => {
    if (!user?.id) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') fetchProfile(user.id);
    });
    return () => sub.remove();
  }, [user?.id, fetchProfile]);

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

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('[CrewCore] signOut error (clearing local session anyway):', err);
    } finally {
      setUser(null);
      setProfile(null);
      setTenant(null);
    }
  }, []);

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
    user, profile, tenant, loading,
    signIn, signOut, refreshProfile, sendOtp, verifyOtp,
  }), [user, profile, tenant, loading, signIn, signOut, refreshProfile, sendOtp, verifyOtp]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
