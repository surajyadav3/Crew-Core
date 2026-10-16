import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { useFeatures } from '@/context/FeatureContext';
import { supabase } from '@/lib/supabase';
import { presentLocalNotification } from '@/lib/pushNotifications';
import { visibleApprovalKinds, isApproverRole, approvalRouteForNotification, type ApprovalKind } from '@/lib/approvals';
import { fetchPendingCounts, type PendingCounts } from '@/services/approvalService';

// Never shown as a system notification: punches already notify on their own,
// and birthdays / anniversaries are website-only.
const SILENT_TYPES = /^(clock_in|clock_out)$|^birthday|anniversar/i;

type ApprovalsContextType = {
  /** Manager / HOD / Management / HR — gets the Team tab and the approvals inbox. */
  isApprover: boolean;
  kinds: ApprovalKind[];
  counts: PendingCounts;
  total: number;
  /** Re-counts; skipped if the last count is under 30 s old unless `force`. */
  refresh: (force?: boolean) => Promise<void>;
};

const ApprovalsContext = createContext<ApprovalsContextType>({
  isApprover: false,
  kinds: [],
  counts: {},
  total: 0,
  refresh: async () => {},
});

const MIN_INTERVAL_MS = 30_000;

/**
 * Pending-request counts shared by the Team tab badge, the Home card and the
 * inbox tiles, so they agree and the server is asked once, not three times.
 */
export function ApprovalsProvider({ children }: { children: React.ReactNode }) {
  const { profile, tenant } = useAuth();
  const { isEnabled, loading: featuresLoading } = useFeatures();
  const [counts, setCounts] = useState<PendingCounts>({});
  const lastRun = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);

  const isApprover = isApproverRole(profile?.role);
  const kinds = useMemo(
    () => (isApprover && !featuresLoading ? visibleApprovalKinds(profile, tenant, isEnabled) : []),
    [isApprover, featuresLoading, profile, tenant, isEnabled],
  );
  const kindsKey = kinds.join(',');

  const refresh = useCallback(async (force = false) => {
    if (!profile || !tenant || kinds.length === 0) { setCounts({}); return; }
    if (!force && Date.now() - lastRun.current < MIN_INTERVAL_MS) return;
    if (inFlight.current) return inFlight.current;
    lastRun.current = Date.now();
    inFlight.current = fetchPendingCounts(profile, tenant, kinds)
      .then(setCounts)
      .catch(() => {})
      .finally(() => { inFlight.current = null; });
    return inFlight.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.role, tenant?.id, kindsKey]);

  useEffect(() => { refresh(true); }, [refresh]);

  useEffect(() => {
    if (!isApprover) return;
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => sub.remove();
  }, [isApprover, refresh]);

  // Live feed of this person's own notifications (app_notifications is in the
  // realtime publication since web migration 20261016_1). A new team request
  // refreshes the counts straight away. On Android — which has no push token
  // until Firebase is set up for the app — it is also shown as a system
  // notification while the app is running; iOS already gets it as a push.
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`app-notifications-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'app_notifications', filter: `profile_id=eq.${profile.id}` },
        (payload: any) => {
          const n = payload.new || {};
          if (!n.type || SILENT_TYPES.test(n.type)) return;
          if (isApprover && approvalRouteForNotification(n)) refresh(true);
          if (Platform.OS === 'android') {
            presentLocalNotification(n.title || 'CrewCore', n.body || '', { type: n.type, link_key: n.link_key, related_id: n.related_id });
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, isApprover, refresh]);

  const total = useMemo(() => Object.values(counts).reduce((a, b) => a + (b || 0), 0), [counts]);
  const value = useMemo(() => ({ isApprover, kinds, counts, total, refresh }), [isApprover, kinds, counts, total, refresh]);

  return <ApprovalsContext.Provider value={value}>{children}</ApprovalsContext.Provider>;
}

export const useApprovals = () => useContext(ApprovalsContext);
