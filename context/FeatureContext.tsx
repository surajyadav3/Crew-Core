import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { listCompanyFeatureToggles, resolveFeatureState, FeatureToggle } from '@/services/featureService';
import { isRaniwalaTenant } from '@/lib/helpers';

type FeatureContextType = {
  isEnabled: (featureKey?: string | null) => boolean;
  loading: boolean;
  refresh: () => Promise<void>;
};

const FeatureContext = createContext<FeatureContextType>({
  isEnabled: () => true,
  loading: true,
  refresh: async () => {},
});

/**
 * Mirrors the web app's FeatureContext.jsx: a superadmin can toggle individual
 * CrewCore features on/off per company (and per outlet) from the payroll web
 * dashboard's Platform console. CrewCore only ever runs as a regular employee,
 * so — unlike the web version, which lets admin/superadmin preview a
 * different outlet's toggle state — the effective outlet is always just the
 * signed-in employee's own profile.outlet_id.
 */
export function FeatureProvider({ children }: { children: React.ReactNode }) {
  const { profile, tenant } = useAuth();
  const [toggles, setToggles] = useState<FeatureToggle[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tenant?.id) {
      setToggles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await listCompanyFeatureToggles(tenant.id);
    setToggles(data);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  const isEnabled = useCallback((featureKey?: string | null) => {
    if (!featureKey) return true;
    if (!tenant?.id) return true;
    // Raniwala doesn't use special requests — hidden regardless of any toggle
    // row. Mirrors the web FeatureContext.
    if (featureKey === 'special_requests' && isRaniwalaTenant(tenant)) return false;
    return resolveFeatureState(toggles, featureKey, profile?.outlet_id || null);
  }, [tenant, toggles, profile?.outlet_id]);

  const value = useMemo(() => ({ isEnabled, loading, refresh: load }), [isEnabled, loading, load]);

  return <FeatureContext.Provider value={value}>{children}</FeatureContext.Provider>;
}

export const useFeatures = () => useContext(FeatureContext);
