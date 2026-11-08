DO $$
DECLARE
  g RECORD;
  p RECORD;
  v_invoice_id UUID;
  v_invoice_number TEXT;
  v_item_id UUID;
  v_subtotal NUMERIC;
  v_created_by UUID;
BEGIN
  FOR g IN
    SELECT
      restaurant_id,
      supplier_id,
      COALESCE(invoice_number,
               'PUR-' || to_char(date_trunc('minute', MIN(received_at)), 'YYYYMMDD-HH24MISS')
      ) AS group_invoice_number,
      MIN(received_at) AS first_received,
      SUM(total_cost) AS total,
      invoice_number AS raw_invoice_number,
      date_trunc('minute', received_at) AS minute_bucket
    FROM public.purchases
    WHERE invoice_item_id IS NULL
    GROUP BY restaurant_id, supplier_id, invoice_number, date_trunc('minute', received_at)
  LOOP
    v_invoice_number := g.group_invoice_number;
    IF EXISTS (
      SELECT 1 FROM public.purchase_invoices
      WHERE restaurant_id = g.restaurant_id AND invoice_number = v_invoice_number
    ) THEN
      v_invoice_number := v_invoice_number || '-' || substr(gen_random_uuid()::text, 1, 6);
    END IF;

    v_subtotal := g.total;

    SELECT received_by INTO v_created_by
    FROM public.purchases
    WHERE restaurant_id = g.restaurant_id
      AND supplier_id IS NOT DISTINCT FROM g.supplier_id
      AND invoice_number IS NOT DISTINCT FROM g.raw_invoice_number
      AND date_trunc('minute', received_at) = g.minute_bucket
      AND received_by IS NOT NULL
    LIMIT 1;

    IF v_created_by IS NULL THEN
      SELECT owner_id INTO v_created_by FROM public.restaurants WHERE id = g.restaurant_id;
    END IF;

    INSERT INTO public.purchase_invoices (
      restaurant_id, supplier_id, invoice_number, invoice_date,
      subtotal, tax_amount, total_amount, status, notes, created_by, created_at
    ) VALUES (
      g.restaurant_id,
      g.supplier_id,
      v_invoice_number,
      g.first_received::date,
      v_subtotal,
      0,
      v_subtotal,
      'paid',
      'Backfilled from legacy purchases',
      v_created_by,
      g.first_received
    )
    RETURNING id INTO v_invoice_id;

    FOR p IN
      SELECT pu.id, pu.inventory_item_id, pu.quantity_received, pu.unit_cost, pu.total_cost,
             COALESCE(ii.name, 'Item') AS item_name
      FROM public.purchases pu
      LEFT JOIN public.inventory_items ii ON ii.id = pu.inventory_item_id
      WHERE pu.invoice_item_id IS NULL
        AND pu.restaurant_id = g.restaurant_id
        AND pu.supplier_id IS NOT DISTINCT FROM g.supplier_id
        AND pu.invoice_number IS NOT DISTINCT FROM g.raw_invoice_number
        AND date_trunc('minute', pu.received_at) = g.minute_bucket
    LOOP
      INSERT INTO public.invoice_items (
        invoice_id, inventory_item_id, description, quantity, unit_price, total_price,
        auto_create_purchase
      ) VALUES (
        v_invoice_id,
        p.inventory_item_id,
        p.item_name,
        p.quantity_received,
        p.unit_cost,
        p.total_cost,
        FALSE
      )
      RETURNING id INTO v_item_id;

      UPDATE public.purchases
      SET invoice_item_id = v_item_id,
          invoice_number = v_invoice_number
      WHERE id = p.id;
    END LOOP;
  END LOOP;
END $$;