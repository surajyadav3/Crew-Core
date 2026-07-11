-- =============================================================
-- PayrollPro — Full Database Migration
-- Paste this entire file into the Supabase SQL Editor and run it.
-- Safe to run multiple times — all policies are dropped before recreating.
-- =============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- =============================================================
-- 1. TABLES
-- =============================================================

CREATE TABLE IF NOT EXISTS tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name    text NOT NULL,
  domain          text,
  join_code       text,
  work_days       int  NOT NULL DEFAULT 26,
  pay_day         int  NOT NULL DEFAULT 1,
  currency        text NOT NULL DEFAULT '₹',
  shift_start     text NOT NULL DEFAULT '09:00',
  shift_end       text NOT NULL DEFAULT '18:00',
  late_threshold  int  NOT NULL DEFAULT 15,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS join_code text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS geofence_lat numeric;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS geofence_lng numeric;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS geofence_radius integer DEFAULT 200;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS min_half_day_hours numeric DEFAULT 4;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS min_full_day_hours numeric DEFAULT 8;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_join_code_unique ON tenants(upper(join_code));

CREATE TABLE IF NOT EXISTS profiles (
  id                   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id            uuid REFERENCES tenants(id) ON DELETE CASCADE,
  first_name           text NOT NULL DEFAULT '',
  last_name            text NOT NULL DEFAULT '',
  email                text NOT NULL DEFAULT '',
  phone                text NOT NULL DEFAULT '',
  department           text NOT NULL DEFAULT '',
  designation          text NOT NULL DEFAULT '',
  join_date            date,
  ctc                  numeric NOT NULL DEFAULT 0,
  bank_acc             text NOT NULL DEFAULT '',
  pan                  text NOT NULL DEFAULT '',
  aadhar               text NOT NULL DEFAULT '',
  must_change_password boolean NOT NULL DEFAULT false,
  role                 text NOT NULL DEFAULT 'employee'
                         CHECK (role IN ('superadmin','admin','manager','employee')),
  status               text NOT NULL DEFAULT 'Active'
                         CHECK (status IN ('Active','Inactive')),
  created_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS temp_password text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS weekly_holiday text DEFAULT 'Sunday';
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check,
  DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check   CHECK (role   IN ('superadmin','admin','manager','employee')),
  ADD CONSTRAINT profiles_status_check CHECK (status IN ('Active','Inactive'));

CREATE TABLE IF NOT EXISTS shifts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  start_time   time NOT NULL,
  end_time     time NOT NULL,
  total_hours  numeric NOT NULL DEFAULT 9,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES shifts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS salary_components (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  category    text NOT NULL CHECK (category IN ('earning','deduction')),
  calc_type   text NOT NULL CHECK (calc_type IN ('percent_ctc','percent_basic','fixed')),
  percent     numeric NOT NULL DEFAULT 0,
  fixed       numeric NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date         date NOT NULL,
  status       text NOT NULL DEFAULT 'Present'
                 CHECK (status IN ('Present','Absent','Late','Half Day','Leave')),
  total_hours  numeric NOT NULL DEFAULT 0,
  location     text NOT NULL DEFAULT 'Office',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, date)
);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS punch_in_lat numeric;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS punch_in_lng numeric;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS punch_out_lat numeric;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS punch_out_lng numeric;

CREATE TABLE IF NOT EXISTS punches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id  uuid NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  punch_time     text NOT NULL,
  punch_type     text NOT NULL CHECK (punch_type IN ('in','out')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payrolls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month       int  NOT NULL CHECK (month BETWEEN 1 AND 12),
  year        int  NOT NULL,
  status      text NOT NULL DEFAULT 'Processed',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, month, year)
);

CREATE TABLE IF NOT EXISTS payslips (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_id        uuid NOT NULL REFERENCES payrolls(id) ON DELETE CASCADE,
  tenant_id         uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emp_name          text NOT NULL DEFAULT '',
  department        text NOT NULL DEFAULT '',
  designation       text NOT NULL DEFAULT '',
  ctc               numeric NOT NULL DEFAULT 0,
  work_days         int NOT NULL DEFAULT 0,
  total_work_days   int NOT NULL DEFAULT 26,
  gross_earnings    numeric NOT NULL DEFAULT 0,
  total_deductions  numeric NOT NULL DEFAULT 0,
  advance_deduction numeric NOT NULL DEFAULT 0,
  net_pay           numeric NOT NULL DEFAULT 0,
  breakdown         jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS advances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type        text NOT NULL DEFAULT 'Salary Advance',
  amount      numeric NOT NULL DEFAULT 0,
  emi         numeric NOT NULL DEFAULT 0,
  paid        numeric NOT NULL DEFAULT 0,
  balance     numeric NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'Active'
                CHECK (status IN ('Active','Completed')),
  remarks     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_table (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text        NOT NULL,
  otp         text        NOT NULL,
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_table_user_id ON otp_table(user_id);

CREATE TABLE IF NOT EXISTS leave_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  leave_type  text NOT NULL,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  reason      text,
  status      text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  approved_by uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_leave_type_check;
CREATE INDEX IF NOT EXISTS idx_leave_requests_profile ON leave_requests(profile_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_tenant  ON leave_requests(tenant_id, status);

CREATE TABLE IF NOT EXISTS push_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,
  device_type text NOT NULL DEFAULT 'unknown',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_profile ON push_tokens(profile_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_tenant  ON push_tokens(tenant_id);

-- NOTE: pre-existing table from the crewcore.in web app — kept here only so a fresh
-- install ends up with the same shape (pdf_url/pdf_name for attached policy documents).
CREATE TABLE IF NOT EXISTS policies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenants(id)  ON DELETE CASCADE,
  created_by  uuid REFERENCES profiles(id) ON DELETE CASCADE,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  pdf_url     text NOT NULL DEFAULT '',
  pdf_name    text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_policies_tenant ON policies(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS policy_reads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id   uuid NOT NULL REFERENCES policies(id)  ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  read_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_policy_reads_policy  ON policy_reads(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_reads_profile ON policy_reads(profile_id);

-- NOTE: pre-existing table from the crewcore.in web app — kept here only so a fresh
-- install ends up with the same shape. Uses `message` (not `body`) and a `department`
-- column for department-scoped delivery (default 'All' = everyone).
CREATE TABLE IF NOT EXISTS announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenants(id)  ON DELETE CASCADE,
  created_by  uuid REFERENCES profiles(id) ON DELETE CASCADE,
  department  text NOT NULL DEFAULT 'All',
  title       text NOT NULL,
  message     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_announcements_tenant ON announcements(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  read        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_profile ON notifications(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS attendance_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attendance_id   uuid REFERENCES attendance(id) ON DELETE SET NULL,
  profile_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  changed_by      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date            date NOT NULL,
  action          text NOT NULL CHECK (action IN ('create','update')),
  old_status      text,
  new_status      text NOT NULL,
  old_hours       numeric,
  new_hours       numeric,
  reason          text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);


-- =============================================================
-- 2. ROW-LEVEL SECURITY
-- =============================================================

ALTER TABLE tenants               ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_components     ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance            ENABLE ROW LEVEL SECURITY;
ALTER TABLE punches               ENABLE ROW LEVEL SECURITY;
ALTER TABLE payrolls              ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslips              ENABLE ROW LEVEL SECURITY;
ALTER TABLE advances              ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_table             ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_audit_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens            ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies                ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_reads             ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements            ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications             ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION my_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

-- ---- tenants ----
DROP POLICY IF EXISTS "tenant: superadmin sees all"   ON tenants;
DROP POLICY IF EXISTS "tenant: members see own"        ON tenants;
DROP POLICY IF EXISTS "tenant: admin can update own"   ON tenants;

CREATE POLICY "tenant: superadmin sees all"
  ON tenants FOR SELECT USING (my_role() = 'superadmin');

CREATE POLICY "tenant: members see own"
  ON tenants FOR SELECT USING (id = my_tenant_id());

CREATE POLICY "tenant: admin can update own"
  ON tenants FOR UPDATE
  USING (id = my_tenant_id() AND my_role() IN ('admin','manager'));

-- ---- profiles ----
DROP POLICY IF EXISTS "profiles: admin/manager sees tenant"          ON profiles;
DROP POLICY IF EXISTS "profiles: employee sees self"                 ON profiles;
DROP POLICY IF EXISTS "profiles: admin/manager can update tenant"    ON profiles;
DROP POLICY IF EXISTS "profiles: admin/manager can delete from tenant" ON profiles;

CREATE POLICY "profiles: admin/manager sees tenant"
  ON profiles FOR SELECT
  USING (tenant_id = my_tenant_id() OR my_role() = 'superadmin');

CREATE POLICY "profiles: employee sees self"
  ON profiles FOR SELECT USING (id = auth.uid());

CREATE POLICY "profiles: admin/manager can update tenant"
  ON profiles FOR UPDATE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "profiles: admin/manager can delete from tenant"
  ON profiles FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

-- ---- shifts ----
DROP POLICY IF EXISTS "shifts: read for tenant" ON shifts;
DROP POLICY IF EXISTS "shifts: write for admin" ON shifts;

CREATE POLICY "shifts: read for tenant"
  ON shifts FOR SELECT USING (tenant_id = my_tenant_id());

CREATE POLICY "shifts: write for admin"
  ON shifts FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() = 'admin');

-- ---- departments ----
DROP POLICY IF EXISTS "departments: tenant members can read"   ON departments;
DROP POLICY IF EXISTS "departments: admin/manager can insert"  ON departments;
DROP POLICY IF EXISTS "departments: admin/manager can delete"  ON departments;

CREATE POLICY "departments: tenant members can read"
  ON departments FOR SELECT USING (tenant_id = my_tenant_id());

CREATE POLICY "departments: admin/manager can insert"
  ON departments FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager'));

CREATE POLICY "departments: admin/manager can delete"
  ON departments FOR DELETE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager'));

-- ---- salary_components ----
DROP POLICY IF EXISTS "salary_components: tenant members can read" ON salary_components;
DROP POLICY IF EXISTS "salary_components: admin/manager can write" ON salary_components;

CREATE POLICY "salary_components: tenant members can read"
  ON salary_components FOR SELECT USING (tenant_id = my_tenant_id());

CREATE POLICY "salary_components: admin/manager can write"
  ON salary_components FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager'));

-- ---- attendance ----
DROP POLICY IF EXISTS "attendance: admin/manager sees tenant"  ON attendance;
DROP POLICY IF EXISTS "attendance: employee sees own"          ON attendance;
DROP POLICY IF EXISTS "attendance: employee can insert own"    ON attendance;
DROP POLICY IF EXISTS "attendance: employee can update own"    ON attendance;
DROP POLICY IF EXISTS "attendance: admin can insert any"       ON attendance;
DROP POLICY IF EXISTS "attendance: admin can update any"       ON attendance;

CREATE POLICY "attendance: admin/manager sees tenant"
  ON attendance FOR SELECT
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "attendance: employee sees own"
  ON attendance FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "attendance: employee can insert own"
  ON attendance FOR INSERT
  WITH CHECK (profile_id = auth.uid() AND tenant_id = my_tenant_id());

CREATE POLICY "attendance: employee can update own"
  ON attendance FOR UPDATE USING (profile_id = auth.uid());

CREATE POLICY "attendance: admin can insert any"
  ON attendance FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager'));

CREATE POLICY "attendance: admin can update any"
  ON attendance FOR UPDATE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager'));

-- ---- punches ----
DROP POLICY IF EXISTS "punches: employee can read own"        ON punches;
DROP POLICY IF EXISTS "punches: admin/manager can read tenant" ON punches;
DROP POLICY IF EXISTS "punches: employee can insert own"      ON punches;
DROP POLICY IF EXISTS "punches: admin/manager can insert"     ON punches;
DROP POLICY IF EXISTS "punches: admin/manager can delete"     ON punches;

CREATE POLICY "punches: employee can read own"
  ON punches FOR SELECT
  USING (attendance_id IN (SELECT id FROM attendance WHERE profile_id = auth.uid()));

CREATE POLICY "punches: admin/manager can read tenant"
  ON punches FOR SELECT
  USING (attendance_id IN (SELECT id FROM attendance WHERE tenant_id = my_tenant_id()));

CREATE POLICY "punches: employee can insert own"
  ON punches FOR INSERT
  WITH CHECK (attendance_id IN (SELECT id FROM attendance WHERE profile_id = auth.uid()));

CREATE POLICY "punches: admin/manager can insert"
  ON punches FOR INSERT
  WITH CHECK (
    attendance_id IN (SELECT id FROM attendance WHERE tenant_id = my_tenant_id())
    AND my_role() IN ('admin','manager','superadmin')
  );

CREATE POLICY "punches: admin/manager can delete"
  ON punches FOR DELETE
  USING (
    attendance_id IN (SELECT id FROM attendance WHERE tenant_id = my_tenant_id())
    AND my_role() IN ('admin','manager','superadmin')
  );

-- ---- payrolls ----
DROP POLICY IF EXISTS "payrolls: tenant members can read"  ON payrolls;
DROP POLICY IF EXISTS "payrolls: admin/manager can write"  ON payrolls;

CREATE POLICY "payrolls: tenant members can read"
  ON payrolls FOR SELECT USING (tenant_id = my_tenant_id());

CREATE POLICY "payrolls: admin/manager can write"
  ON payrolls FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager'));

-- ---- payslips ----
DROP POLICY IF EXISTS "payslips: admin/manager sees tenant" ON payslips;
DROP POLICY IF EXISTS "payslips: employee sees own"         ON payslips;
DROP POLICY IF EXISTS "payslips: admin/manager can write"   ON payslips;

CREATE POLICY "payslips: admin/manager sees tenant"
  ON payslips FOR SELECT
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "payslips: employee sees own"
  ON payslips FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "payslips: admin/manager can write"
  ON payslips FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager'));

-- ---- advances ----
DROP POLICY IF EXISTS "advances: admin/manager sees tenant" ON advances;
DROP POLICY IF EXISTS "advances: employee sees own"         ON advances;
DROP POLICY IF EXISTS "advances: admin/manager can write"   ON advances;

CREATE POLICY "advances: admin/manager sees tenant"
  ON advances FOR SELECT
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "advances: employee sees own"
  ON advances FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "advances: admin/manager can write"
  ON advances FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager'));

-- ---- leave_requests ----
DROP POLICY IF EXISTS "leaves: admin sees tenant"      ON leave_requests;
DROP POLICY IF EXISTS "leaves: employee sees own"      ON leave_requests;
DROP POLICY IF EXISTS "leaves: employee can insert own" ON leave_requests;
DROP POLICY IF EXISTS "leaves: admin can update tenant" ON leave_requests;

CREATE POLICY "leaves: admin sees tenant"
  ON leave_requests FOR SELECT
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "leaves: employee sees own"
  ON leave_requests FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "leaves: employee can insert own"
  ON leave_requests FOR INSERT
  WITH CHECK (profile_id = auth.uid() AND tenant_id = my_tenant_id());

CREATE POLICY "leaves: admin can update tenant"
  ON leave_requests FOR UPDATE
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

-- ---- attendance_audit_log ----
DROP POLICY IF EXISTS "audit_log: admin/manager can read tenant" ON attendance_audit_log;
DROP POLICY IF EXISTS "audit_log: admin/manager can insert"      ON attendance_audit_log;

CREATE POLICY "audit_log: admin/manager can read tenant"
  ON attendance_audit_log FOR SELECT
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

CREATE POLICY "audit_log: admin/manager can insert"
  ON attendance_audit_log FOR INSERT
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','manager','superadmin'));

-- ---- push_tokens ----
DROP POLICY IF EXISTS "push_tokens: user manages own" ON push_tokens;

CREATE POLICY "push_tokens: user manages own"
  ON push_tokens FOR ALL
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid() AND tenant_id = my_tenant_id());

-- ---- policies ----
DROP POLICY IF EXISTS "policies: tenant members can read" ON policies;
DROP POLICY IF EXISTS "policies: admin/superadmin can write" ON policies;

CREATE POLICY "policies: tenant members can read"
  ON policies FOR SELECT USING (tenant_id = my_tenant_id());

CREATE POLICY "policies: admin/superadmin can write"
  ON policies FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

-- ---- policy_reads ----
DROP POLICY IF EXISTS "policy_reads: user inserts own" ON policy_reads;
DROP POLICY IF EXISTS "policy_reads: creator/admin can read" ON policy_reads;

CREATE POLICY "policy_reads: user inserts own"
  ON policy_reads FOR INSERT
  WITH CHECK (profile_id = auth.uid() AND tenant_id = my_tenant_id());

CREATE POLICY "policy_reads: creator/admin can read"
  ON policy_reads FOR SELECT
  USING (
    tenant_id = my_tenant_id()
    AND (profile_id = auth.uid() OR my_role() IN ('admin','superadmin'))
  );

-- ---- announcements ----
DROP POLICY IF EXISTS "announcements: tenant members can read" ON announcements;
DROP POLICY IF EXISTS "announcements: admin/superadmin can write" ON announcements;

CREATE POLICY "announcements: tenant members can read"
  ON announcements FOR SELECT USING (tenant_id = my_tenant_id());

CREATE POLICY "announcements: admin/superadmin can write"
  ON announcements FOR ALL
  USING (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'))
  WITH CHECK (tenant_id = my_tenant_id() AND my_role() IN ('admin','superadmin'));

-- ---- notifications ----
DROP POLICY IF EXISTS "notifications: user sees own" ON notifications;
DROP POLICY IF EXISTS "notifications: user can mark own read" ON notifications;

CREATE POLICY "notifications: user sees own"
  ON notifications FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "notifications: user can mark own read"
  ON notifications FOR UPDATE USING (profile_id = auth.uid());


-- =============================================================
-- 3. RPC FUNCTIONS
-- =============================================================

DROP FUNCTION IF EXISTS create_workspace(text, text, text);
DROP FUNCTION IF EXISTS create_workspace(text, text, text, uuid);
CREATE OR REPLACE FUNCTION create_workspace(
  p_company_name  text,
  p_first_name    text,
  p_last_name     text,
  p_user_id       uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_join_code text;
  v_uid       uuid := COALESCE(p_user_id, auth.uid());
  v_email     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No authenticated user. Pass p_user_id explicitly.';
  END IF;
  LOOP
    v_join_code := upper(substring(replace(gen_random_uuid()::text,'-','') FROM 1 FOR 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE upper(join_code) = v_join_code);
  END LOOP;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  INSERT INTO tenants (company_name, join_code)
  VALUES (p_company_name, v_join_code)
  RETURNING id INTO v_tenant_id;
  INSERT INTO profiles (id, tenant_id, first_name, last_name, email, role, status)
  VALUES (v_uid, v_tenant_id, p_first_name, p_last_name, COALESCE(v_email,''), 'admin', 'Active')
  ON CONFLICT (id) DO UPDATE SET
    tenant_id  = EXCLUDED.tenant_id,
    first_name = EXCLUDED.first_name,
    last_name  = EXCLUDED.last_name,
    email      = EXCLUDED.email,
    role       = 'admin',
    status     = 'Active';
  RETURN v_join_code;
END;
$$;

DROP FUNCTION IF EXISTS insert_employee_profile(uuid,text,text,text,text,text,text,numeric,date,text,text,text);
DROP FUNCTION IF EXISTS insert_employee_profile(uuid,text,text,text,text,text,text,numeric,date,text,text,text,text);
CREATE OR REPLACE FUNCTION insert_employee_profile(
  p_user_id       uuid,
  p_first_name    text,
  p_last_name     text,
  p_email         text,
  p_phone         text,
  p_department    text,
  p_designation   text,
  p_ctc           numeric,
  p_join_date     date,
  p_bank_acc      text,
  p_pan           text,
  p_aadhar        text,
  p_temp_password text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM profiles WHERE id = auth.uid();
  INSERT INTO profiles (
    id, tenant_id,
    first_name, last_name, email, phone,
    department, designation,
    ctc, join_date,
    bank_acc, pan, aadhar,
    role, status, must_change_password, temp_password
  ) VALUES (
    p_user_id, v_tenant_id,
    p_first_name, p_last_name, p_email, COALESCE(p_phone,''),
    COALESCE(p_department,''), COALESCE(p_designation,''),
    COALESCE(p_ctc, 0), p_join_date,
    COALESCE(p_bank_acc,''), COALESCE(p_pan,''), COALESCE(p_aadhar,''),
    'employee', 'Active', true, p_temp_password
  );
END;
$$;

DROP FUNCTION IF EXISTS lookup_org(text);
CREATE OR REPLACE FUNCTION lookup_org(p_org_code text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_name FROM tenants
  WHERE upper(join_code) = upper(trim(p_org_code))
  LIMIT 1;
$$;

DROP FUNCTION IF EXISTS employee_join_workspace(text, text, text);
DROP FUNCTION IF EXISTS employee_join_workspace(text, text, text, uuid);
CREATE OR REPLACE FUNCTION employee_join_workspace(
  p_org_code   text,
  p_first_name text,
  p_last_name  text,
  p_user_id    uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_uid       uuid := COALESCE(p_user_id, auth.uid());
  v_email     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No authenticated user. Pass p_user_id explicitly.';
  END IF;
  SELECT id INTO v_tenant_id FROM tenants
  WHERE upper(join_code) = upper(trim(p_org_code));
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid organization code. Please check with your manager.';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_uid) THEN
    RAISE EXCEPTION 'An account already exists for this email. Please log in instead.';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  INSERT INTO profiles (id, tenant_id, first_name, last_name, email, role, status)
  VALUES (v_uid, v_tenant_id, p_first_name, p_last_name, COALESCE(v_email,''), 'employee', 'Active');
  RETURN 'ok';
END;
$$;

DROP FUNCTION IF EXISTS clear_must_change_password();
CREATE OR REPLACE FUNCTION clear_must_change_password()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles SET must_change_password = false WHERE id = auth.uid();
END;
$$;

-- Resolves a phone number (as entered by HR on the employee's profile) to the
-- email address their Supabase Auth account was created with, so the login
-- screen can accept either identifier while auth itself stays email-based.
-- Runs pre-login (anon), so it only ever returns an email — never other
-- profile fields — and only for Active employees.
DROP FUNCTION IF EXISTS get_email_by_phone(text);
CREATE OR REPLACE FUNCTION get_email_by_phone(p_phone text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email FROM profiles
  WHERE phone = trim(p_phone) AND status = 'Active' AND email <> ''
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION create_workspace(text,text,text,uuid)                                                      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION insert_employee_profile(uuid,text,text,text,text,text,text,numeric,date,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION lookup_org(text)                                                                           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION employee_join_workspace(text,text,text,uuid)                                               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION clear_must_change_password()                                                               TO authenticated;
GRANT EXECUTE ON FUNCTION get_email_by_phone(text)                                                                   TO anon, authenticated;


-- =============================================================
-- 3b. PUSH NOTIFICATION TRIGGERS (policies, announcements, leave decisions)
-- =============================================================
-- Requires the pg_net extension (bundled on Supabase-hosted Postgres) to make
-- an outbound HTTP call from a trigger to the `send-notification` edge function.
--
-- ONE-TIME MANUAL STEP after running this migration:
--   select vault.create_secret('https://<project-ref>.functions.supabase.co/send-notification', 'edge_function_url');
--   select vault.create_secret('<service-role-key>', 'edge_function_service_key');
-- (Replace <project-ref> and <service-role-key> with your project's values —
-- never commit the actual service-role key into this file.)

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION notify_via_edge_function(payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'edge_function_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'edge_function_service_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'edge_function_url / edge_function_service_key not set in Vault — skipping push notification';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := payload
  );
END;
$$;

CREATE OR REPLACE FUNCTION trg_notify_policy_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM notify_via_edge_function(jsonb_build_object(
    'tenant_id', NEW.tenant_id, 'target', 'all', 'type', 'policy',
    'title', 'New Policy: ' || NEW.title, 'body', left(NEW.body, 160)
  ));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_policy_created ON policies;
CREATE TRIGGER on_policy_created AFTER INSERT ON policies
  FOR EACH ROW EXECUTE FUNCTION trg_notify_policy_created();

-- Fires once per (policy, viewer) — policy_reads has a UNIQUE(policy_id, profile_id)
-- and the client upserts with ON CONFLICT DO NOTHING, so repeat opens never re-insert
-- and never re-notify. Skips notifying the creator about their own view.
CREATE OR REPLACE FUNCTION trg_notify_policy_read()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_created_by uuid;
  v_title      text;
  v_viewer     text;
BEGIN
  SELECT created_by, title INTO v_created_by, v_title FROM policies WHERE id = NEW.policy_id;
  IF v_created_by IS NULL OR v_created_by = NEW.profile_id THEN
    RETURN NEW;
  END IF;
  SELECT trim(first_name || ' ' || last_name) INTO v_viewer FROM profiles WHERE id = NEW.profile_id;
  PERFORM notify_via_edge_function(jsonb_build_object(
    'tenant_id', NEW.tenant_id, 'target', 'user:' || v_created_by, 'type', 'policy_read',
    'title', 'Policy viewed', 'body', coalesce(v_viewer, 'Someone') || ' viewed "' || v_title || '"'
  ));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_policy_read ON policy_reads;
CREATE TRIGGER on_policy_read AFTER INSERT ON policy_reads
  FOR EACH ROW EXECUTE FUNCTION trg_notify_policy_read();

-- NOTE: the `announcements` table pre-existed (from the crewcore.in web app) with a
-- `message` column (not `body`) and a `department` column (default 'All'). This trigger
-- targets 'all' regardless of department — department-scoped delivery is handled by the
-- table's own RLS read policy, not by this push dispatch.
CREATE OR REPLACE FUNCTION trg_notify_announcement_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM notify_via_edge_function(jsonb_build_object(
    'tenant_id', NEW.tenant_id, 'target', 'all', 'type', 'announcement',
    'title', 'Announcement: ' || NEW.title, 'body', left(NEW.message, 160)
  ));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_announcement_created ON announcements;
CREATE TRIGGER on_announcement_created AFTER INSERT ON announcements
  FOR EACH ROW EXECUTE FUNCTION trg_notify_announcement_created();

CREATE OR REPLACE FUNCTION trg_notify_leave_status_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('Approved', 'Rejected') THEN
    PERFORM notify_via_edge_function(jsonb_build_object(
      'tenant_id', NEW.tenant_id, 'target', 'user:' || NEW.profile_id,
      'type', CASE WHEN NEW.status = 'Approved' THEN 'leave_approved' ELSE 'leave_rejected' END,
      'title', CASE WHEN NEW.status = 'Approved' THEN 'Leave Approved' ELSE 'Leave Rejected' END,
      'body', NEW.leave_type || ' (' || NEW.start_date || ' to ' || NEW.end_date || ') was ' || lower(NEW.status) || '.'
    ));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_leave_status_changed ON leave_requests;
CREATE TRIGGER on_leave_status_changed AFTER UPDATE OF status ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION trg_notify_leave_status_changed();


-- =============================================================
-- 4. PERFORMANCE INDEXES
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_profiles_tenant_id       ON profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_status   ON profiles(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_role     ON profiles(tenant_id, role);
CREATE INDEX IF NOT EXISTS idx_profiles_email           ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_attendance_profile_date  ON attendance(profile_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_tenant_date   ON attendance(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_punches_attendance_id    ON punches(attendance_id);
CREATE INDEX IF NOT EXISTS idx_payrolls_tenant_month    ON payrolls(tenant_id, month, year);
CREATE INDEX IF NOT EXISTS idx_payslips_payroll_id      ON payslips(payroll_id);
CREATE INDEX IF NOT EXISTS idx_payslips_profile_id      ON payslips(profile_id);
CREATE INDEX IF NOT EXISTS idx_payslips_tenant_id       ON payslips(tenant_id);
CREATE INDEX IF NOT EXISTS idx_advances_tenant_status   ON advances(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_advances_profile_id      ON advances(profile_id);
CREATE INDEX IF NOT EXISTS idx_salary_components_tenant ON salary_components(tenant_id);
CREATE INDEX IF NOT EXISTS idx_departments_tenant       ON departments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_date    ON attendance_audit_log(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_audit_log_attendance     ON attendance_audit_log(attendance_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_profile        ON attendance_audit_log(profile_id);


-- =============================================================
-- 5. BACK-FILL join_code FOR EXISTING TENANTS
-- =============================================================

DO $$
DECLARE
  r      RECORD;
  v_code text;
BEGIN
  FOR r IN SELECT id FROM tenants WHERE join_code IS NULL LOOP
    LOOP
      v_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE upper(join_code) = v_code);
    END LOOP;
    UPDATE tenants SET join_code = v_code WHERE id = r.id;
  END LOOP;
END $$;


-- =============================================================
-- 6. AFTER RUNNING: promote yourself to superadmin
-- Sign up via the app first, then run this once:
-- UPDATE profiles SET role = 'superadmin' WHERE email = 'your@email.com';
-- =============================================================
