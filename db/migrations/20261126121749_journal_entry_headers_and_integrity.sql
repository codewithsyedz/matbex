-- Ledger integrity, phase C (docs/plans/ledger-integrity.md): journal entry headers, a balance
-- check at commit, and an edit guard on ledger lines.
--
-- * journal_entries: one header per posting, keyed like the reports group lines today:
--   (tenant, reference_type, reference_id, else batch_id, else the line itself). Every new line
--   gets its header from a BEFORE INSERT trigger, so none of the ~60 posting functions change.
-- * entry_number: gap-free per tenant, assigned by number_journal_entries() (hourly from the
--   ledger-balance-check job, and here for existing entries) rather than while posting, so POS
--   sales don't queue on a per-tenant counter.
-- * Balance: a deferred constraint trigger checks at commit that each touched entry's live
--   (non-voided) lines balance to the cent.
-- * Edits: a BEFORE UPDATE trigger allows only the void transition (is_voided false -> true,
--   voided_at/by, void_reason), stamping entry_id, and filling a NULL reference_id
--   (post_card_settlement_deposit and post_vat_remittance link lines to the record they create).
-- * Both checks start in LOG mode: a failure is recorded in ledger_integrity_violations and the
--   transaction goes ahead. Switch to enforce per check in ledger_integrity_settings once the log
--   stays empty. The staging copy of production has 0 unbalanced entries over live lines.

-- 1. Tables ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_number bigint,
  entry_date   date NOT NULL,
  source_type  text NOT NULL,
  source_key   text NOT NULL,
  batch_id     uuid,
  branch_id    uuid,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  numbered_at  timestamptz,
  CONSTRAINT journal_entries_source_unique UNIQUE (tenant_id, source_type, source_key),
  CONSTRAINT journal_entries_number_unique UNIQUE (tenant_id, entry_number)
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_unnumbered
  ON public.journal_entries (tenant_id, created_at, id) WHERE entry_number IS NULL;

ALTER TABLE public.account_transactions
  ADD COLUMN IF NOT EXISTS entry_id uuid REFERENCES public.journal_entries(id);
CREATE INDEX IF NOT EXISTS idx_account_transactions_entry ON public.account_transactions (entry_id);

CREATE TABLE IF NOT EXISTS public.ledger_entry_counters (
  tenant_id   uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  last_number bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.ledger_integrity_settings (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  enforce_balance     boolean NOT NULL DEFAULT false,
  enforce_append_only boolean NOT NULL DEFAULT false,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.ledger_integrity_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ledger_integrity_violations (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_id   uuid,
  line_id    uuid,
  kind       text NOT NULL CHECK (kind IN ('unbalanced', 'line_update', 'unvoid')),
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  txid       bigint NOT NULL DEFAULT txid_current(),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_integrity_violations_once
  ON public.ledger_integrity_violations (txid, kind, entry_id, line_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_ledger_integrity_violations_tenant
  ON public.ledger_integrity_violations (tenant_id, created_at DESC);

-- RLS: headers and violations are readable by the tenant's members; nobody writes them from a
-- browser. Counters and settings are internal.
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entry_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_integrity_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_integrity_violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view journal entries"
  ON public.journal_entries FOR SELECT
  USING (public.is_superadmin(auth.uid()) OR public.user_belongs_to_tenant(auth.uid(), tenant_id));
CREATE POLICY "Tenant members can view ledger integrity violations"
  ON public.ledger_integrity_violations FOR SELECT
  USING (public.is_superadmin(auth.uid()) OR public.user_belongs_to_tenant(auth.uid(), tenant_id));

REVOKE ALL ON public.journal_entries, public.ledger_entry_counters, public.ledger_integrity_settings,
              public.ledger_integrity_violations FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.journal_entries, public.ledger_entry_counters,
              public.ledger_integrity_settings, public.ledger_integrity_violations FROM authenticated;

-- 2. Backfill headers for existing lines ----------------------------------------------------
-- Stamping entry_id is an UPDATE, which the period-lock and AP-settlement triggers refuse for
-- old lines. User triggers are off for the backfill only (table owner; foreign keys stay on).
INSERT INTO public.journal_entries (tenant_id, entry_date, source_type, source_key, batch_id, branch_id, created_by, created_at)
SELECT g.tenant_id, g.entry_date, g.source_type, g.source_key, g.batch_id, g.branch_id, g.created_by, g.created_at
  FROM (
    SELECT DISTINCT ON (t.tenant_id, coalesce(t.reference_type, '(none)'),
                        coalesce(t.reference_id::text, 'batch:' || t.batch_id::text, 'line:' || t.id::text))
           t.tenant_id,
           coalesce(t.reference_type, '(none)') AS source_type,
           coalesce(t.reference_id::text, 'batch:' || t.batch_id::text, 'line:' || t.id::text) AS source_key,
           t.transaction_date AS entry_date, t.batch_id, t.branch_id, t.created_by, t.created_at
      FROM public.account_transactions t
     ORDER BY t.tenant_id, coalesce(t.reference_type, '(none)'),
              coalesce(t.reference_id::text, 'batch:' || t.batch_id::text, 'line:' || t.id::text),
              t.created_at, t.id
  ) g
ON CONFLICT (tenant_id, source_type, source_key) DO NOTHING;

ALTER TABLE public.account_transactions DISABLE TRIGGER USER;
UPDATE public.account_transactions t
   SET entry_id = e.id
  FROM public.journal_entries e
 WHERE t.entry_id IS NULL
   AND e.tenant_id = t.tenant_id
   AND e.source_type = coalesce(t.reference_type, '(none)')
   AND e.source_key = coalesce(t.reference_id::text, 'batch:' || t.batch_id::text, 'line:' || t.id::text);
ALTER TABLE public.account_transactions ENABLE TRIGGER USER;

-- 3. Numbering ------------------------------------------------------------------------------
-- Gives every committed header without a number the next number for its tenant, oldest first.
-- Internal: the migration and the ledger-balance-check function (service role).
CREATE OR REPLACE FUNCTION public.number_journal_entries(p_tenant_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  v_last   bigint;
  v_count  integer := 0;
  v_n      integer;
BEGIN
  FOR v_tenant IN
    SELECT DISTINCT e.tenant_id FROM public.journal_entries e
     WHERE e.entry_number IS NULL AND (p_tenant_id IS NULL OR e.tenant_id = p_tenant_id)
  LOOP
    INSERT INTO public.ledger_entry_counters (tenant_id) VALUES (v_tenant) ON CONFLICT DO NOTHING;
    SELECT last_number INTO v_last FROM public.ledger_entry_counters WHERE tenant_id = v_tenant FOR UPDATE;

    WITH todo AS (
      SELECT e.id, v_last + row_number() OVER (ORDER BY e.created_at, e.id) AS n
        FROM public.journal_entries e
       WHERE e.tenant_id = v_tenant AND e.entry_number IS NULL
    )
    UPDATE public.journal_entries e
       SET entry_number = todo.n, numbered_at = now()
      FROM todo
     WHERE e.id = todo.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    UPDATE public.ledger_entry_counters SET last_number = v_last + v_n WHERE tenant_id = v_tenant;
    v_count := v_count + v_n;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.number_journal_entries(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.number_journal_entries(uuid) TO service_role;

SELECT public.number_journal_entries(NULL);

-- 4. New lines get their header -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_journal_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_type text := coalesce(NEW.reference_type, '(none)');
  v_key  text := coalesce(NEW.reference_id::text, 'batch:' || NEW.batch_id::text, 'line:' || NEW.id::text);
  v_id   uuid;
BEGIN
  IF NEW.entry_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO v_id FROM public.journal_entries
   WHERE tenant_id = NEW.tenant_id AND source_type = v_type AND source_key = v_key;
  IF v_id IS NULL THEN
    -- clock_timestamp(): entries created in one transaction are numbered in the order posted.
    INSERT INTO public.journal_entries (tenant_id, entry_date, source_type, source_key, batch_id, branch_id, created_by, created_at)
    VALUES (NEW.tenant_id, NEW.transaction_date, v_type, v_key, NEW.batch_id, NEW.branch_id, coalesce(NEW.created_by, auth.uid()), clock_timestamp())
    ON CONFLICT (tenant_id, source_type, source_key) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN  -- created by a concurrent transaction that has now committed
      SELECT id INTO v_id FROM public.journal_entries
       WHERE tenant_id = NEW.tenant_id AND source_type = v_type AND source_key = v_key;
    END IF;
  END IF;
  NEW.entry_id := v_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.assign_journal_entry() FROM PUBLIC, anon, authenticated;

-- Runs right after the tenant check (aaa_enforce_ledger_account_tenant).
DROP TRIGGER IF EXISTS aab_assign_journal_entry ON public.account_transactions;
CREATE TRIGGER aab_assign_journal_entry
  BEFORE INSERT ON public.account_transactions
  FOR EACH ROW EXECUTE FUNCTION public.assign_journal_entry();

-- 5. Each entry balances at commit ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_journal_entry_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dr numeric;
  v_cr numeric;
  v_enforce boolean;
BEGIN
  IF NEW.entry_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(sum(coalesce(debit, 0)), 0), coalesce(sum(coalesce(credit, 0)), 0)
    INTO v_dr, v_cr
    FROM public.account_transactions
   WHERE entry_id = NEW.entry_id AND NOT coalesce(is_voided, false);
  IF round(abs(v_dr - v_cr), 2) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT enforce_balance INTO v_enforce FROM public.ledger_integrity_settings WHERE id;
  IF coalesce(v_enforce, false) THEN
    RAISE EXCEPTION 'LEDGER_UNBALANCED: journal entry % does not balance (debits %, credits %)',
      NEW.entry_id, round(v_dr, 2), round(v_cr, 2) USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.ledger_integrity_violations (tenant_id, entry_id, kind, detail)
  VALUES (NEW.tenant_id, NEW.entry_id, 'unbalanced',
          jsonb_build_object('debit', round(v_dr, 2), 'credit', round(v_cr, 2),
                             'reference_type', NEW.reference_type, 'reference_id', NEW.reference_id))
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.check_journal_entry_balance() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_check_journal_entry_balance ON public.account_transactions;
CREATE CONSTRAINT TRIGGER zz_check_journal_entry_balance
  AFTER INSERT OR UPDATE OF debit, credit, is_voided, entry_id ON public.account_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_journal_entry_balance();

-- 6. Lines are append-only apart from voiding -----------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_ledger_line_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_skip    text[] := ARRAY['is_voided', 'voided_at', 'voided_by', 'void_reason'];
  v_old     jsonb;
  v_new     jsonb;
  v_kind    text;
  v_changed text[];
  v_enforce boolean;
BEGIN
  -- Stamping a missing header, and linking a line to the record its posting function creates.
  IF OLD.entry_id IS NULL THEN v_skip := array_append(v_skip, 'entry_id'); END IF;
  IF OLD.reference_id IS NULL THEN v_skip := array_append(v_skip, 'reference_id'); END IF;

  v_old := to_jsonb(OLD) - v_skip;
  v_new := to_jsonb(NEW) - v_skip;

  IF coalesce(OLD.is_voided, false) AND NOT coalesce(NEW.is_voided, false) THEN
    v_kind := 'unvoid';
  ELSIF v_old IS DISTINCT FROM v_new THEN
    v_kind := 'line_update';
  ELSE
    RETURN NEW;
  END IF;

  SELECT array_agg(k ORDER BY k) INTO v_changed
    FROM jsonb_object_keys(v_new) AS k
   WHERE v_new -> k IS DISTINCT FROM v_old -> k;

  SELECT enforce_append_only INTO v_enforce FROM public.ledger_integrity_settings WHERE id;
  IF coalesce(v_enforce, false) THEN
    RAISE EXCEPTION 'LEDGER_APPEND_ONLY: ledger lines cannot be changed (% on %); void the entry or post a reversal',
      coalesce(array_to_string(v_changed, ', '), v_kind), OLD.id USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.ledger_integrity_violations (tenant_id, entry_id, line_id, kind, detail)
  VALUES (OLD.tenant_id, OLD.entry_id, OLD.id, v_kind,
          jsonb_build_object('changed', to_jsonb(v_changed), 'reference_type', OLD.reference_type,
                             'old', ledger_jsonb_pick(v_old, v_changed),
                             'new', ledger_jsonb_pick(v_new, v_changed)))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- Picks the listed keys out of a jsonb object (helper for the violation detail).
CREATE OR REPLACE FUNCTION public.ledger_jsonb_pick(p_obj jsonb, p_keys text[])
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT coalesce(jsonb_object_agg(k, p_obj -> k), '{}'::jsonb) FROM unnest(coalesce(p_keys, '{}')) AS k
$$;

REVOKE ALL ON FUNCTION public.guard_ledger_line_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_jsonb_pick(jsonb, text[]) FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS aab_guard_ledger_line_update ON public.account_transactions;
CREATE TRIGGER aab_guard_ledger_line_update
  BEFORE UPDATE ON public.account_transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_ledger_line_update();
