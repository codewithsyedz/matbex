CREATE POLICY "Accountants can add inventory" ON public.inventory_items FOR INSERT TO authenticated WITH CHECK (public.can_access_restaurant(restaurant_id) AND public.has_role(auth.uid(), restaurant_id, 'accountant'::public.app_role) AND (branch_id IS NULL OR public.user_can_access_branch(auth.uid(), restaurant_id, branch_id)));
GRANT SELECT, INSERT ON public.inventory_items TO authenticated;
CREATE OR REPLACE FUNCTION public.assert_expense_correction_access(p_expense_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.expenses%ROWTYPE;
BEGIN
 SELECT * INTO e FROM public.expenses WHERE id=p_expense_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
 IF auth.uid() IS NULL OR NOT public.can_access_restaurant(e.restaurant_id) OR e.tenant_id IS DISTINCT FROM public.get_restaurant_tenant_id(e.restaurant_id) OR NOT (public.is_superadmin(auth.uid()) OR public.has_role(auth.uid(),e.restaurant_id,'owner'::public.app_role) OR public.has_role(auth.uid(),e.restaurant_id,'manager'::public.app_role) OR public.has_role(auth.uid(),e.restaurant_id,'accountant'::public.app_role)) OR (e.branch_id IS NOT NULL AND NOT public.user_can_access_branch(auth.uid(),e.restaurant_id,e.branch_id)) THEN RAISE EXCEPTION 'Not authorized to correct this expense'; END IF;
 IF e.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id=e.branch_id AND b.restaurant_id=e.restaurant_id) THEN RAISE EXCEPTION 'Invalid expense branch'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.assert_expense_correction_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_expense_correction_access(uuid) TO authenticated, service_role;
DO $migration$
DECLARE definition text;
BEGIN
 definition := pg_get_functiondef('public.amend_posted_expense(uuid,text,numeric,numeric,date,text,uuid,uuid,uuid)'::regprocedure);
 IF position('v_amount := ROUND' in definition)=0 OR position('WHERE t.reference_type = ''expense''' in definition)=0 THEN RAISE EXCEPTION 'Unexpected expense amendment definition'; END IF;
 definition := replace(definition, 'v_amount := ROUND', 'PERFORM public.assert_expense_correction_access(p_expense_id);
  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts a WHERE a.id=COALESCE(p_account_id,v_expense.account_id) AND a.tenant_id=v_expense.tenant_id AND COALESCE(a.is_active,true)) THEN RAISE EXCEPTION ''Invalid expense account for this tenant''; END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.expense_categories c WHERE c.id=p_category_id AND c.restaurant_id=v_expense.restaurant_id) THEN RAISE EXCEPTION ''Invalid expense category''; END IF;
  IF p_supplier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id=p_supplier_id AND public.get_restaurant_tenant_id(s.restaurant_id)=v_expense.tenant_id) THEN RAISE EXCEPTION ''Invalid supplier''; END IF;
  v_amount := ROUND');
 definition := replace(definition, 'v_vat := ROUND(COALESCE(p_vat_amount, v_expense.vat_amount, 0), 2);', 'v_vat := ROUND(COALESCE(p_vat_amount, CASE WHEN COALESCE(v_expense.amount,0)>0 THEN v_amount * COALESCE(v_expense.vat_amount,0) / v_expense.amount ELSE 0 END), 2);');
 definition := replace(definition, 'WHERE t.reference_type = ''expense''', 'WHERE t.reference_type IN (''expense'', ''correction'')');
 definition := replace(definition, 'net_amount = ROUND(v_amount - v_vat, 2),', 'net_amount = ROUND(v_amount - v_vat, 2),
      vat_rate = CASE WHEN v_vat=0 THEN 0 ELSE COALESCE(v_expense.vat_rate,0) END,
      vat_split_status = CASE WHEN v_vat=0 THEN ''not_applicable'' ELSE ''applied'' END,');
 definition := replace(definition, 'DELETE FROM public.journal_entry_batches WHERE id = v_batch_id;', 'RAISE EXCEPTION ''Cannot amend a posted expense without an active journal footprint'';');
 EXECUTE definition;
END $migration$;
ALTER FUNCTION public.guard_posted_expense_edit() SECURITY INVOKER;
CREATE OR REPLACE FUNCTION public.reverse_expense_vat(p_expense_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.expenses%ROWTYPE; result jsonb; before_lines jsonb; after_lines jsonb;
BEGIN
 PERFORM public.assert_expense_correction_access(p_expense_id);
 IF length(btrim(COALESCE(p_reason,'')))<3 THEN RAISE EXCEPTION 'A reason is required to reverse VAT'; END IF;
 SELECT * INTO e FROM public.expenses WHERE id=p_expense_id FOR UPDATE;
 IF COALESCE(e.vat_amount,0)<=0 THEN RAISE EXCEPTION 'This expense has no VAT to reverse'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]'::jsonb) INTO before_lines FROM public.account_transactions t WHERE t.reference_id=e.id AND t.reference_type IN ('expense','correction') AND NOT COALESCE(t.is_voided,false);
 IF COALESCE(e.ledger_posted,false) THEN
  result := public.amend_posted_expense(e.id,'VAT reversal: '||btrim(p_reason),p_vat_amount=>0);
 ELSE
  PERFORM set_config('matbex.expense_amend','on',true);
  UPDATE public.expenses SET vat_amount=0,net_amount=amount,vat_rate=0,vat_split_status='not_applicable',updated_at=now() WHERE id=e.id;
  PERFORM set_config('matbex.expense_amend','off',true);
  result := jsonb_build_object('expense_id',e.id);
 END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]'::jsonb) INTO after_lines FROM public.account_transactions t WHERE t.reference_id=e.id AND t.reference_type IN ('expense','correction') AND NOT COALESCE(t.is_voided,false);
 INSERT INTO public.expense_vat_split_audit(tenant_id,restaurant_id,branch_id,expense_id,action,rate_percent,amount_before,net_before,vat_before,status_before,amount_after,net_after,vat_after,status_after,ledger_posted,batch_id,ledger_before,ledger_after,note,performed_by)
 VALUES(e.tenant_id,e.restaurant_id,e.branch_id,e.id,'marked_not_applicable',0,e.amount,e.net_amount,e.vat_amount,e.vat_split_status,e.amount,e.amount,0,'not_applicable',e.ledger_posted,(result->>'reversal_batch_id')::uuid,before_lines,after_lines,'VAT reversal: '||btrim(p_reason),auth.uid());
 RETURN result || jsonb_build_object('vat_reversed',e.vat_amount,'amount',e.amount);
END; $$;
REVOKE ALL ON FUNCTION public.reverse_expense_vat(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_expense_vat(uuid,text) TO authenticated,service_role;