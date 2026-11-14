-- Live updates for POS and back-office screens over the event channel (Socket.IO, transactional
-- outbox) instead of /realtime/v1 table subscriptions.
--
-- One generic trigger emits a small "this row changed" event per row:
--   topic   = TG_ARGV[0]              ('pos' for the till side, 'sales' for back-office figures)
--   type    = '<table>.<insert|update|delete>'
--   payload = { table, op, id, branch_id?, <extra columns named in TG_ARGV[1..]> }
-- No row contents: one restaurant room holds users with different roles, so screens refetch
-- through their normal, RLS-checked queries. Rooms are joined only after
-- can_access_restaurant() (server/src/realtime/socket.ts).
CREATE OR REPLACE FUNCTION platform.trg_outbox_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, platform
AS $$
DECLARE
  r jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  payload jsonb;
  i int;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NULL;
  END IF;
  IF r->>'restaurant_id' IS NULL THEN
    RETURN NULL;
  END IF;
  payload := jsonb_build_object('table', TG_TABLE_NAME, 'op', lower(TG_OP), 'id', r->'id');
  IF r ? 'branch_id' THEN
    payload := payload || jsonb_build_object('branch_id', r->'branch_id');
  END IF;
  FOR i IN 1 .. coalesce(TG_NARGS, 0) - 1 LOOP
    payload := payload || jsonb_build_object(TG_ARGV[i], r->TG_ARGV[i]);
  END LOOP;
  PERFORM platform.emit_event(TG_ARGV[0], TG_TABLE_NAME || '.' || lower(TG_OP),
                              (r->>'restaurant_id')::uuid, (r->>'id')::uuid, payload);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION platform.trg_outbox_row_change() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('pos_tables', 'pos', ''),
      ('online_orders', 'pos', ''),
      ('menu_items', 'pos', ''),
      ('menu_item_branch_prices', 'pos', ''),
      ('pos_entity_versions', 'pos', ', ''entity_type'', ''entity_id'''),
      ('inventory_items', 'pos', ''),
      ('kiosk_unlock_requests', 'pos', ''),
      ('sales_transactions', 'sales', ''),
      ('sales_items', 'sales', ''),
      ('shifts', 'sales', ''),
      ('cash_events', 'sales', ''),
      ('expenses', 'sales', '')
    ) AS v(tbl, topic, extra)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_outbox_row_change ON public.%I', t.tbl);
    EXECUTE format(
      'CREATE TRIGGER zz_outbox_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION platform.trg_outbox_row_change(%L%s)',
      t.tbl, t.topic, t.extra);
  END LOOP;
END $$;
