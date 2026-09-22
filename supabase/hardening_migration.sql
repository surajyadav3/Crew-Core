-- =============================================================
-- CrewCore — Security Hardening Migration (self-approval bypass fix)
-- =============================================================
-- DO NOT RUN THIS BLINDLY. Read the notes below, then run it in the
-- Supabase SQL editor against a staging project first if you have one.
-- It is written to be idempotent (safe to re-run) like migration.sql.
--
-- WHY THIS MIGRATION EXISTS
-- --------------------------------------------------------------
-- The mobile app currently decides on the CLIENT whether a leave /
-- overtime / attendance-regularize request should be auto-approved,
-- based on a monthly "self-approval quota" (services/requestQuotaService.ts,
-- SELF_LIMIT = 3). It then INSERTs the row directly into Postgres with
-- status already set to 'Approved' when the client believes the quota
-- allows it.
--
-- The Row-Level Security policy that guards that insert
-- (see migration.sql, "leaves: employee can insert own") only checks
--     profile_id = auth.uid() AND tenant_id = my_tenant_id()
-- It does NOT restrict which columns the client is allowed to set. That
-- means any authenticated employee — by calling the Supabase REST API
-- directly instead of going through the app UI, e.g. with a proxy or a
-- patched build — can INSERT a leave_requests row (or, if these tables
-- have the same shape, a special_requests row carrying `overtime_pay`,
-- or a regularize_requests row) with status = 'Approved' and
-- required_approver_role = 'self' UNCONDITIONALLY, with no quota check
-- at all. For special_requests this is a direct payroll-fraud vector
-- (self-approved, self-priced overtime pay).
--
-- THE FIX
-- --------------------------------------------------------------
-- Move quota evaluation server-side: a BEFORE INSERT trigger recomputes
-- status / required_approver_role / approval_level / self_approved_count
-- from the *server's* copy of request_quotas, ignoring whatever the
-- client sent for those columns. The app's optimistic "Auto-approved!"
-- toast still matches reality because the trigger runs the exact same
-- tier logic the client already predicts (SELF_LIMIT=3, MANAGER_LIMIT=5).
--
-- IMPORTANT — SCOPE OF THIS FILE
-- --------------------------------------------------------------
-- This repo's migration.sql does not define `regularize_requests`,
-- `special_requests` or `request_quotas` at all, even though the app
-- (services/attendanceService.ts, specialRequestService.ts,
-- requestQuotaService.ts) actively reads/writes them — the checked-in
-- schema has drifted from production. `request_quotas` is defined here
-- (CREATE TABLE IF NOT EXISTS) based on the exact columns the app code
-- uses, and `leave_requests` is hardened below since its schema IS in
-- migration.sql and can be verified. `special_requests` and
-- `regularize_requests` need the identical BEFORE INSERT pattern applied
-- once their real column list is exported from production
-- (`pg_dump --schema-only`) — do not skip this, `special_requests`
-- carries `overtime_pay`, making it the highest-value target.
-- =============================================================

CREATE TABLE IF NOT EXISTS request_quotas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id            uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  month                 int  NOT NULL,
  year                  int  NOT NULL,
  self_approved_count   int  NOT NULL DEFAULT 0,
  manager_approved_count int NOT NULL DEFAULT 0,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, profile_id, month, year)
);
ALTER TABLE request_quotas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "request_quotas: user reads own" ON request_quotas;
CREATE POLICY "request_quotas: user reads own"
  ON request_quotas FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "request_quotas: admin/manager reads tenant" ON request_quotas;
CREATE POLICY "request_quotas: admin/manager reads tenant"
  ON request_quotas FOR SELECT
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

-- No client-side INSERT/UPDATE policy is granted on purpose: quota rows
-- are only ever written by the SECURITY DEFINER trigger function below,
-- which bypasses RLS. This is what stops a client from resetting or
-- forging its own quota counters.

-- ---- Server-side tier evaluation, shared by every request table ----
CREATE OR REPLACE FUNCTION evaluate_request_tier(p_tenant_id uuid, p_profile_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_month int := extract(month from now())::int;
  v_year  int := extract(year from now())::int;
  v_quota request_quotas%ROWTYPE;
  v_tier  text;
BEGIN
  INSERT INTO request_quotas (tenant_id, profile_id, month, year)
  VALUES (p_tenant_id, p_profile_id, v_month, v_year)
  ON CONFLICT (tenant_id, profile_id, month, year) DO NOTHING;

  SELECT * INTO v_quota FROM request_quotas
  WHERE tenant_id = p_tenant_id AND profile_id = p_profile_id
    AND month = v_month AND year = v_year
  FOR UPDATE; -- lock the row so concurrent submissions can't both slip in under the limit

  IF v_quota.self_approved_count < 3 THEN
    v_tier := 'self';
    UPDATE request_quotas SET self_approved_count = self_approved_count + 1, updated_at = now()
      WHERE id = v_quota.id;
  ELSIF v_quota.manager_approved_count < 5 THEN
    v_tier := 'manager';
  ELSE
    v_tier := 'admin';
  END IF;

  RETURN v_tier;
END;
$$;

-- ---- leave_requests: force server-computed status on every insert ----
CREATE OR REPLACE FUNCTION trg_enforce_leave_request_tier()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tier text;
BEGIN
  IF NEW.profile_id <> auth.uid() THEN
    RAISE EXCEPTION 'Cannot submit a leave request on behalf of another employee.';
  END IF;

  v_tier := evaluate_request_tier(NEW.tenant_id, NEW.profile_id);
  NEW.status := CASE WHEN v_tier = 'self' THEN 'Approved' ELSE 'Pending' END;
  NEW.required_approver_role := v_tier;
  NEW.approval_level := CASE WHEN v_tier = 'self' THEN 'self' ELSE NULL END;
  NEW.approved_by := CASE WHEN v_tier = 'self' THEN NEW.profile_id ELSE NULL END;
  RETURN NEW;
END;
$$;

ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS required_approver_role text;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approval_level text;

DROP TRIGGER IF EXISTS enforce_leave_request_tier ON leave_requests;
CREATE TRIGGER enforce_leave_request_tier
  BEFORE INSERT ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION trg_enforce_leave_request_tier();

-- ---- increment_request_quota RPC ----
-- services/requestQuotaService.ts calls this for every self/manager-tier
-- regularize_requests and special_requests submission (there's no trigger
-- backing those two tables yet — see the TODO at the bottom of this file),
-- but the function itself was never defined here, so every one of those
-- submissions has been failing outright with "function
-- increment_request_quota(...) does not exist" before the insert ever runs.
-- Do NOT also call this for leave_requests — evaluate_request_tier() above
-- already bumps self_approved_count for those from inside the BEFORE INSERT
-- trigger, so calling this RPC too would double-count every leave request
-- (services/leaveService.ts no longer calls it, on purpose).
CREATE OR REPLACE FUNCTION increment_request_quota(p_tenant_id uuid, p_profile_id uuid, p_field text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_month int := extract(month from now())::int;
  v_year  int := extract(year from now())::int;
BEGIN
  IF p_profile_id <> auth.uid() THEN
    RAISE EXCEPTION 'Cannot modify another employee''s request quota.';
  END IF;
  IF p_field NOT IN ('self_approved_count', 'manager_approved_count') THEN
    RAISE EXCEPTION 'Invalid quota field: %', p_field;
  END IF;

  INSERT INTO request_quotas (tenant_id, profile_id, month, year)
  VALUES (p_tenant_id, p_profile_id, v_month, v_year)
  ON CONFLICT (tenant_id, profile_id, month, year) DO NOTHING;

  IF p_field = 'self_approved_count' THEN
    UPDATE request_quotas SET self_approved_count = self_approved_count + 1, updated_at = now()
      WHERE tenant_id = p_tenant_id AND profile_id = p_profile_id AND month = v_month AND year = v_year;
  ELSE
    UPDATE request_quotas SET manager_approved_count = manager_approved_count + 1, updated_at = now()
      WHERE tenant_id = p_tenant_id AND profile_id = p_profile_id AND month = v_month AND year = v_year;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_request_quota(uuid, uuid, text) TO authenticated;

-- Employees can still update their own rows per the existing "employee sees own"
-- policy family, but only admins/managers have an UPDATE policy on this table
-- (see migration.sql), so an employee cannot edit status after insert — only the
-- trigger (on insert) and admin/manager (via their own UPDATE policy) can set it.

-- ---- attendance: stop employees from hand-editing their own hours/status ----
-- "attendance: employee can update own" (migration.sql) has no WITH CHECK and
-- no column restriction, so a direct API call can PATCH total_hours/status to
-- anything on any of the employee's own rows — bypassing the punch-derived
-- calculation clockOut() does client-side (services/attendanceService.ts).
-- This trigger recomputes total_hours/status from the actual `punches` rows
-- whenever a non-admin updates their own attendance row, ignoring whatever
-- values the client tried to set. Admin/manager edits (e.g. manual
-- corrections) pass through untouched.
CREATE OR REPLACE FUNCTION trg_recompute_attendance_from_punches()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total numeric := 0;
  v_half  numeric;
  v_full  numeric;
  v_in    record;
  v_out   record;
  v_ins   text[];
  v_outs  text[];
  i       int;
BEGIN
  IF my_role() IN ('admin','manager','superadmin') THEN
    RETURN NEW; -- trust manual admin corrections
  END IF;

  SELECT array_agg(punch_time ORDER BY punch_time) INTO v_ins
    FROM punches WHERE attendance_id = NEW.id AND punch_type = 'in';
  SELECT array_agg(punch_time ORDER BY punch_time) INTO v_outs
    FROM punches WHERE attendance_id = NEW.id AND punch_type = 'out';

  IF v_ins IS NOT NULL THEN
    FOR i IN 1 .. array_length(v_ins, 1) LOOP
      IF v_outs IS NOT NULL AND i <= array_length(v_outs, 1) THEN
        -- Overnight shift (e.g. in 22:00, out 06:00 next day) makes a naive
        -- time-time subtraction negative; wrap past midnight instead of
        -- letting GREATEST(...,0) below silently zero the whole shift. Keeps
        -- this in sync with lib/helpers.ts diffHours, which wraps the same way.
        v_total := v_total + (
          (EXTRACT(EPOCH FROM (v_outs[i]::time - v_ins[i]::time))::numeric % 86400 + 86400) % 86400
        ) / 3600.0;
      END IF;
    END LOOP;
  END IF;

  SELECT COALESCE(min_half_day_hours, 4), COALESCE(min_full_day_hours, 8)
    INTO v_half, v_full FROM tenants WHERE id = NEW.tenant_id;

  NEW.total_hours := GREATEST(round(v_total * 100) / 100, 0);
  -- Boundary matches the client's own convention (services/attendanceService.ts
  -- clockOut/applyRegularization both use >=), so this trigger's recompute
  -- can't silently downgrade a status the client just computed for the same hours.
  NEW.status := CASE
    WHEN NEW.total_hours >= v_full THEN 'Present'
    WHEN NEW.total_hours >= v_half THEN 'Half Day'
    ELSE 'Absent'
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recompute_attendance_from_punches ON attendance;
CREATE TRIGGER recompute_attendance_from_punches
  BEFORE UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION trg_recompute_attendance_from_punches();

-- =============================================================
-- TODO (requires production schema, not guessable from this repo):
--   1. Export special_requests / regularize_requests DDL:
--        supabase db dump --schema public -f prod_schema.sql
--      (or pg_dump --schema-only), and add both CREATE TABLE statements
--      to migration.sql so the checked-in schema stops drifting from prod.
--   2. Apply the same BEFORE INSERT pattern as trg_enforce_leave_request_tier
--      above to special_requests (this is the one with `overtime_pay` —
--      highest priority) and regularize_requests, reusing
--      evaluate_request_tier(tenant_id, profile_id) for the tier decision.
--   3. For special_requests specifically, also recompute overtime_pay
--      server-side (mirror lib/helpers.ts calcPayableOvertimeHours /
--      calcOtPay using the employee's stored ctc and the tenant's shift
--      hours) instead of trusting the numeric value the client submits —
--      today a modified client can submit any overtime_pay figure and,
--      if under the self-approval quota, have it auto-approved.
-- =============================================================
