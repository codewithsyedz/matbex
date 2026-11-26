-- outbox_events_for_kitchen_tickets
--
-- Transactional outbox (docs/self-hosting/ARCHITECTURE.md, "Realtime"): business changes write
-- an event row in the same transaction; the worker's outbox publisher sends committed events
-- through Redis to the API's Socket.IO server, which delivers them to the kitchen displays and
-- POS terminals in that restaurant's room. An event exists only if its change committed.
--
-- The table lives in schema "platform", which PostgREST does not expose: browsers never read
-- it directly. Kitchen tickets and their items are the first producers, through triggers, so
-- every path that creates or changes a ticket (POS sale, guest QR order, KDS status updates,
-- future /api/v1 modules) emits events without code changes. New modules can also call
-- platform.emit_event() explicitly inside their transaction.

CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.outbox_events (
  id            bigserial PRIMARY KEY,
  topic         text        NOT NULL,              -- room family, e.g. 'kds'
  event_type    text        NOT NULL,              -- e.g. 'kds.ticket.updated'
  tenant_id     uuid,
  restaurant_id uuid,
  aggregate_id  uuid,
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_events_unpublished_idx ON platform.outbox_events (id) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS outbox_events_published_at_idx ON platform.outbox_events (published_at) WHERE published_at IS NOT NULL;

ALTER TABLE platform.outbox_events ENABLE ROW LEVEL SECURITY;  -- no policies: only the owner (API/worker) reads it
REVOKE ALL ON platform.outbox_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE platform.outbox_events_id_seq FROM PUBLIC, anon, authenticated;

-- Writes one event and wakes the publisher. NOTIFY is delivered only when the transaction commits.
CREATE OR REPLACE FUNCTION platform.emit_event(
  _topic text, _event_type text, _restaurant_id uuid, _aggregate_id uuid, _payload jsonb
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, platform
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO platform.outbox_events (topic, event_type, tenant_id, restaurant_id, aggregate_id, payload)
  VALUES (_topic, _event_type,
          (SELECT tenant_id FROM public.restaurants WHERE id = _restaurant_id),
          _restaurant_id, _aggregate_id, coalesce(_payload, '{}'::jsonb))
  RETURNING id INTO v_id;
  PERFORM pg_notify('outbox_event', v_id::text);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION platform.emit_event(text, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Kitchen tickets ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.trg_outbox_kds_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, platform
AS $$
DECLARE
  r record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_type text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NULL;
  END IF;
  v_type := CASE
    WHEN TG_OP = 'INSERT' THEN 'kds.ticket.created'
    WHEN TG_OP = 'DELETE' THEN 'kds.ticket.deleted'
    WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'kds.ticket.status_changed'
    ELSE 'kds.ticket.updated'
  END;
  PERFORM platform.emit_event('kds', v_type, r.restaurant_id, r.id, jsonb_build_object(
    'ticket', jsonb_build_object(
      'id', r.id, 'ticket_number', r.ticket_number, 'source', r.source, 'table_label', r.table_label,
      'status', r.status, 'priority', r.priority, 'created_at', r.created_at, 'updated_at', r.updated_at),
    'previous_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION platform.trg_outbox_kds_ticket_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, platform
AS $$
DECLARE
  r record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NULL;
  END IF;
  PERFORM platform.emit_event('kds',
    CASE TG_OP WHEN 'INSERT' THEN 'kds.item.created' WHEN 'DELETE' THEN 'kds.item.deleted' ELSE 'kds.item.updated' END,
    r.restaurant_id, r.ticket_id, jsonb_build_object(
      'item', jsonb_build_object(
        'id', r.id, 'ticket_id', r.ticket_id, 'name', r.name_snapshot, 'quantity', r.quantity,
        'station_id', r.station_id, 'status', r.status)));
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION platform.trg_outbox_kds_ticket() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION platform.trg_outbox_kds_ticket_item() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_outbox_kds_ticket ON public.pos_kds_tickets;
CREATE TRIGGER trg_outbox_kds_ticket
  AFTER INSERT OR UPDATE OR DELETE ON public.pos_kds_tickets
  FOR EACH ROW EXECUTE FUNCTION platform.trg_outbox_kds_ticket();

DROP TRIGGER IF EXISTS trg_outbox_kds_ticket_item ON public.pos_kds_ticket_items;
CREATE TRIGGER trg_outbox_kds_ticket_item
  AFTER INSERT OR UPDATE OR DELETE ON public.pos_kds_ticket_items
  FOR EACH ROW EXECUTE FUNCTION platform.trg_outbox_kds_ticket_item();
