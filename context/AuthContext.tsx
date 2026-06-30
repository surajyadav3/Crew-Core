import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { sendOtp as svcSendOtp, verifyOtp as svcVerifyOtp } from '@/services/otpService';
import { useNotification } from '@/lib/notifications';

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
  [key: string]: any;
};

type AuthContextType = {
  user: any;
  profile: Profile | null;
  tenant: Tenant | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<any>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<any>;
  sendOtp: (identifier: string) => Promise<any>;
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

    const init = async () => {
      const timeoutId = setTimeout(() => { if (mounted) setLoading(false); }, 8000);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) return;
        if (session?.user) {
          setUser(session.user);
          await fetchProfile(session.user.id);
        }
      } catch (err) {
        console.error('[CrewCore] Auth init error:', err);
      } finally {
        clearTimeout(timeoutId);
        if (mounted) setLoading(false);
      }
    };

    init().catch((err) => console.error('[CrewCore] Auth init unhandled:', err));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      try {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (session?.user) {
            setUser(session.user);
            setTimeout(() => {
              if (mounted) fetchProfile(session.user.id).catch((e) => console.error('[CrewCore] fetchProfile error:', e));
            }, 300);
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

  const { notify } = useNotification();

  // Listen for leave status changes and show in-app notification
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
            notify('Leave Approved ✅', `Your ${leaveType} request has been approved.`, 'success');
          } else if (newStatus === 'Rejected') {
            notify('Leave Rejected ❌', `Your ${leaveType} request was not approved.`, 'error');
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, notify]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setTenant(null);
  }, []);

  const refreshProfile = useCallback(() => {
    if (user?.id) return fetchProfile(user.id);
    return Promise.resolve(null);
  }, [user, fetchProfile]);

  const sendOtp = useCallback((identifier: string) => svcSendOtp(identifier), []);
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
