-- Applied 2026-09-25. Policy acknowledgement source + download log for the app.

-- Where an acknowledgement came from (the mobile app vs the website) and on
-- which device, so HR can see who acknowledged from their phone.
ALTER TABLE public.policy_acknowledgements
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS device text;

-- Every policy download, so HR can see who downloaded which policy and from where.
CREATE TABLE IF NOT EXISTS public.policy_downloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'app',
  device text,
  downloaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_policy_downloads_policy ON public.policy_downloads(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_downloads_tenant ON public.policy_downloads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_policy_downloads_profile ON public.policy_downloads(profile_id);

ALTER TABLE public.policy_downloads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_downloads: self insert" ON public.policy_downloads;
CREATE POLICY "policy_downloads: self insert" ON public.policy_downloads
  FOR INSERT WITH CHECK (profile_id = auth.uid() AND tenant_id = (SELECT my_tenant_id()));

DROP POLICY IF EXISTS "policy_downloads: self or HR select" ON public.policy_downloads;
CREATE POLICY "policy_downloads: self or HR select" ON public.policy_downloads
  FOR SELECT USING (
    tenant_id = (SELECT my_tenant_id())
    AND (profile_id = auth.uid() OR (SELECT my_role()) IN ('admin', 'superadmin', 'manager'))
  );

GRANT SELECT, INSERT ON public.policy_downloads TO authenticated;
