import { supabase } from '@/lib/supabase';

export type FeatureToggle = {
  id: string;
  tenant_id: string;
  outlet_id: string | null;
  feature_key: string;
  enabled: boolean;
  updated_at?: string;
  updated_by?: string | null;
};

/** Every override row (company-wide + all outlets) for one tenant. */
export async function listCompanyFeatureToggles(tenantId: string): Promise<{ data: FeatureToggle[]; error: any }> {
  const { data, error } = await supabase
    .from('company_feature_toggles')
    .select('*')
    .eq('tenant_id', tenantId);
  return { data: data || [], error };
}

/**
 * Resolves whether a feature is enabled for a given outlet, falling back to
 * the company-wide override, falling back to `defaultEnabled` — mirrors the
 * website's resolveFeatureState() outlet-then-company-then-default fallback.
 * `defaultEnabled` is true for every ordinary feature — a tenant with zero
 * rows in company_feature_toggles keeps 100% of default functionality.
 */
export function resolveFeatureState(
  toggles: FeatureToggle[],
  featureKey: string,
  outletId: string | null | undefined,
  defaultEnabled = true
): boolean {
  if (outletId) {
    const outletRow = toggles.find((t) => t.feature_key === featureKey && t.outlet_id === outletId);
    if (outletRow) return outletRow.enabled;
  }
  const companyRow = toggles.find((t) => t.feature_key === featureKey && t.outlet_id === null);
  if (companyRow) return companyRow.enabled;
  return defaultEnabled;
}

/**
 * One-off lookup of a single feature's enabled state for one outlet, for call
 * sites that only care about that one feature and don't already hold the
 * full toggles list the way FeatureContext does (e.g. attendanceService.ts's
 * clock-in/out geofence check, useClockInOut). Same outlet-then-company-then-
 * default fallback as resolveFeatureState(). Fails open (returns
 * defaultEnabled) on a query error, same philosophy as "not configured"
 * elsewhere in the geofence code. Mirrors the website's
 * isFeatureEnabledForOutlet() exactly.
 */
export async function isFeatureEnabledForOutlet(
  tenantId: string | null | undefined,
  outletId: string | null | undefined,
  featureKey: string,
  defaultEnabled = true
): Promise<boolean> {
  if (!tenantId) return defaultEnabled;
  const { data, error } = await supabase
    .from('company_feature_toggles')
    .select('outlet_id, enabled, feature_key')
    .eq('tenant_id', tenantId)
    .eq('feature_key', featureKey);
  if (error) return defaultEnabled;
  return resolveFeatureState((data || []) as FeatureToggle[], featureKey, outletId, defaultEnabled);
}
