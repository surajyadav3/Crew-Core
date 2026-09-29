-- Applied 2026-09-25. Earned Leave rule:
--   On the 1st of every month, credit the month that just ended with the
--   leave type's accrual_days (Raniwala: 1.5) ONLY if the employee took no
--   earned leave in that month. If they did take leave, no credit — the leave
--   is simply deducted from the running balance (record_leave_deduction).
--   Nothing ever lapses: the balance just keeps carrying forward.

CREATE OR REPLACE FUNCTION public.run_monthly_leave_accrual()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lt    RECORD;
  v_emp   RECORD;
  v_start date := (date_trunc('month', CURRENT_DATE) - interval '1 month')::date; -- first day of the month being credited
  v_end   date := (date_trunc('month', CURRENT_DATE) - interval '1 day')::date;   -- last day of that month
BEGIN
  FOR v_lt IN SELECT * FROM leave_types WHERE accrual_frequency = 'monthly' AND is_active AND accrual_days > 0 LOOP
    FOR v_emp IN
      SELECT id FROM profiles
      WHERE tenant_id = v_lt.tenant_id AND status = 'Active'
        -- Must have been on the rolls for the whole month being credited.
        AND (join_date IS NULL OR join_date <= v_start)
    LOOP
      -- Already credited this run (idempotent).
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM leave_ledger
        WHERE profile_id = v_emp.id AND leave_type_id = v_lt.id AND entry_type = 'Accrual'
          AND date_trunc('month', effective_date) = date_trunc('month', CURRENT_DATE)
      );
      -- The opening balance entered by HR on/after that month already covers it
      -- (e.g. the Sept 2026 upload already includes September's 1.5). Only the
      -- employee's FIRST ledger entry counts — later HR top-ups (marriage leave
      -- etc.) must not cancel a month's credit.
      CONTINUE WHEN (
        SELECT MIN(effective_date) FROM leave_ledger
        WHERE profile_id = v_emp.id AND leave_type_id = v_lt.id
      ) >= v_start;
      -- Took this leave type during that month (approved or still pending) → no credit.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM leave_requests lr
        WHERE lr.profile_id = v_emp.id
          AND lr.leave_type = v_lt.name
          AND lr.status IN ('Approved', 'Pending')
          AND lr.start_date <= v_end AND lr.end_date >= v_start
      );

      INSERT INTO leave_ledger (tenant_id, profile_id, leave_type_id, entry_type, days, effective_date, note)
      VALUES (v_lt.tenant_id, v_emp.id, v_lt.id, 'Accrual', v_lt.accrual_days, CURRENT_DATE,
              'No leave taken in ' || to_char(v_start, 'FMMonth YYYY') || ' — monthly credit');
    END LOOP;
  END LOOP;
END;
$function$;

-- The ledger balance already persists across years, so year-end only needs to
-- expire anything above the cap. The old version also re-credited the carried
-- amount, which doubled everyone's balance every April.
CREATE OR REPLACE FUNCTION public.run_yearly_leave_carry_forward()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lt  RECORD;
  v_bal RECORD;
BEGIN
  FOR v_lt IN SELECT * FROM leave_types WHERE carry_forward AND is_active LOOP
    FOR v_bal IN
      SELECT profile_id, SUM(days) AS balance
      FROM leave_ledger
      WHERE leave_type_id = v_lt.id
      GROUP BY profile_id
      HAVING SUM(days) > v_lt.max_carry_forward_days
    LOOP
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM leave_ledger
        WHERE profile_id = v_bal.profile_id AND leave_type_id = v_lt.id AND entry_type = 'Expiry'
          AND date_trunc('year', effective_date) = date_trunc('year', CURRENT_DATE)
      );
      INSERT INTO leave_ledger (tenant_id, profile_id, leave_type_id, entry_type, days, note)
      VALUES (v_lt.tenant_id, v_bal.profile_id, v_lt.id, 'Expiry', -(v_bal.balance - v_lt.max_carry_forward_days),
              'Unused balance above carry-forward cap expired');
    END LOOP;
  END LOOP;
END;
$function$;

-- Raniwala: carry forward ALL unused earned leave (no cap).
UPDATE public.leave_types lt
SET max_carry_forward_days = 9999
FROM public.tenants t
WHERE t.id = lt.tenant_id AND t.company_name ILIKE '%raniwala%' AND lt.name = 'Earned Leave';
