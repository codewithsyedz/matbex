-- pos_receipt_counters
--
-- Receipt numbers for sales recorded through /api/v1/pos/sales: RCP-YYYYMMDD-0001, -0002, ...
-- per restaurant and business day. The previous scheme (browser and the sales_transactions
-- trigger) appends 4 random digits, which collides on busy days. The counter row is updated
-- inside the sale's transaction, so a rolled-back sale does not consume a number visibly and
-- two tills never get the same number. Only the API (table owner) uses it.

CREATE TABLE IF NOT EXISTS platform.pos_receipt_counters (
  restaurant_id uuid    NOT NULL,
  day           date    NOT NULL,
  last_value    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (restaurant_id, day)
);
ALTER TABLE platform.pos_receipt_counters ENABLE ROW LEVEL SECURITY;  -- owner only
REVOKE ALL ON platform.pos_receipt_counters FROM PUBLIC, anon, authenticated;
