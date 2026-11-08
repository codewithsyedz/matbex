DO $$
DECLARE
  r RECORD;
  v_src TEXT;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND CASE WHEN p.prokind = 'f' THEN pg_get_functiondef(p.oid) LIKE '%Employee Advances Receivable%' ELSE false END
  LOOP
    v_src := replace(pg_get_functiondef(r.oid), 'Employee Advances Receivable', 'Advance to Employees Against Salary');
    EXECUTE v_src;
  END LOOP;
END $$;