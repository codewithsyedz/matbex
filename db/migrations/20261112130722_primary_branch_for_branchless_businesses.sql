-- primary_branch_for_branchless_businesses
--
-- Self-serve trials (start-free-trial) created the business and its restaurant but no branch;
-- only the platform admin's create-branch made one. With no branch, End of Day cannot post
-- (assert_branch_vat_rate_configured needs the branch's VAT rate) and new records carry no
-- branch. start-free-trial now creates the primary branch; this gives one to each business
-- that has no branch at all (on the production copy: one active business with no activity yet
-- and two test businesses). Businesses that already have a branch are left alone: an extra
-- branch would change what per-branch billing charges them.
--
-- Defaults: VAT 15%, prices including VAT (the column defaults), the restaurant's name and
-- timezone. Drawers and shift templates without a branch are attached to it.

DO $$
DECLARE
  r record;
  v_branch uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (rs.tenant_id) rs.id, rs.name, rs.timezone
    FROM restaurants rs
    WHERE NOT EXISTS (
      SELECT 1 FROM branches b JOIN restaurants r2 ON r2.id = b.restaurant_id
      WHERE r2.tenant_id = rs.tenant_id AND b.deleted_at IS NULL)
    ORDER BY rs.tenant_id, rs.is_primary DESC NULLS LAST, rs.created_at
  LOOP
    INSERT INTO branches (restaurant_id, name, timezone, is_primary, is_active)
    VALUES (r.id, r.name, r.timezone, true, true)
    RETURNING id INTO v_branch;
    UPDATE drawers SET branch_id = v_branch WHERE restaurant_id = r.id AND branch_id IS NULL;
    UPDATE shift_templates SET branch_id = v_branch WHERE restaurant_id = r.id AND branch_id IS NULL;
  END LOOP;
END $$;
