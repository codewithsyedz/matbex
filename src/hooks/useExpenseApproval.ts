import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { parseLedgerValidationError } from "@/lib/ledgerValidationError";

export type ExpenseApprovalStatus = 'pending' | 'approved' | 'rejected';
export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'cheque' | 'other';

export interface ExpenseWithApproval {
  id: string;
  tenant_id: string | null;
  restaurant_id: string;
  amount: number;
  description: string | null;
  expense_date: string;
  category_id: string | null;
  created_by: string;
  created_at: string;
  receipt_url: string | null;
  status: 'paid' | 'unpaid';
  account_id: string | null;
  payment_method: PaymentMethod | null;
  approval_status: ExpenseApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  ledger_posted: boolean;
  ledger_transaction_id: string | null;
  // Joined data
  expense_categories?: {
    id: string;
    name: string;
    color: string | null;
  } | null;
  account?: {
    id: string;
    account_code: string;
    account_name: string;
    account_type: string;
  } | null;
  creator?: {
    full_name: string | null;
  } | null;
  approver?: {
    full_name: string | null;
  } | null;
}

export interface CreateExpenseData {
  amount: number;
  /** VAT portion of `amount` — debited to 1180 Input VAT Recoverable when posting. */
  vat_amount?: number;
  /** VAT-exclusive value that hits the expense/inventory account. */
  net_amount?: number;
  /** Whether the entered `amount` already contained VAT. */
  vat_inclusive?: boolean;
  /** VAT rate applied, as a percentage. */
  vat_rate?: number | null;
  description?: string;
  expense_date: string;
  category_id?: string;
  /** Branch this expense belongs to. Falls back to the auto-stamp trigger when omitted. */
  branch_id?: string | null;
  /** Project / CIP cost centre this spend is capitalised against. */
  project_id?: string | null;
  receipt_url?: string;
  status: 'paid' | 'unpaid';
  account_id: string; // Mandatory CoA mapping
  payment_method: PaymentMethod; // Mandatory
  /** Which account funds this expense: company cash/bank or an owner/partner capital account. */
  funding_source?: 'company' | 'owner_capital' | 'partner_capital';
  payment_account_id?: string | null;
  capital_account_id?: string | null;
  inventory_item_id?: string; // Optional - links to inventory and creates purchase
  quantity?: number; // Quantity when linked to inventory item
  // Inventory movement controls (optional - only used when inventory_item_id is set)
  movement_type?: 'purchase' | 'usage'; // 'purchase' increases stock, 'usage' decreases stock
  stock_change_units?: number; // Override absolute stock-unit delta (e.g. 12 liters from 1 case)
  movement_reason?: string;
  // Optional supplier link. When set, a matching purchase_invoices header row
  // is created so the expense also surfaces in the Invoices list.
  supplier_id?: string;
  // Optional itemized invoice mode - when provided (length >= 1), the expense
  // represents a multi-line invoice and `amount` is derived from the line totals.
  // Each line creates its own stock_movements audit row referencing this expense.
  line_items?: ExpenseLineItemInput[];
}

export interface ExpenseLineItemInput {
  inventory_item_id: string;
  quantity: number;            // Expense (purchase) units, e.g. cases
  unit_cost: number;           // Cost per expense unit (e.g. cost per case)
  stock_change_units?: number; // Override the auto stock-unit delta
  movement_type?: 'purchase' | 'usage';
  movement_reason?: string;
}

type AiApprovalPostingResult = {
  expenseId: string;
  posted: boolean;
  alreadyPosted: boolean;
  account?: { code: string; name: string };
  confidence?: number;
  reviewReason?: string;
};

async function approveAndPostExpenseWithAi(
  expenseId: string,
  paymentAccountId?: string | null,
): Promise<AiApprovalPostingResult> {
  // A paid expense cannot post without a funding account (Cash in Hand,
  // Cash in Bank, Petty Cash…). The approver picks it at approval time.
  if (paymentAccountId) {
    const { error: fundingError } = await db
      .from('expenses')
      .update({ payment_account_id: paymentAccountId, funding_source: 'company' })
      .eq('id', expenseId);
    if (fundingError) throw fundingError;
  }

  const { data: approval, error: approvalError } = await db.rpc(
    'approve_expense_for_ai_posting',
    { p_expense_id: expenseId },
  );
  if (approvalError) throw approvalError;

  const approvalState = approval as {
    already_posted?: boolean;
    ledger_transaction_id?: string | null;
  } | null;
  if (approvalState?.already_posted) {
    return { expenseId, posted: true, alreadyPosted: true };
  }

  const { data, error } = await db.functions.invoke('generate-expense-journal', {
    body: { expense_id: expenseId },
  });
  if (error) {
    const context = error.context as Response | undefined;
    let message = error.message || 'AI account selection needs review';
    if (context) {
      const payload = await context.clone().json().catch(() => null);
      message = payload?.error || message;
    }
    return {
      expenseId,
      posted: false,
      alreadyPosted: false,
      reviewReason: message,
    };
  }

  return {
    expenseId,
    posted: data?.posted === true,
    alreadyPosted: false,
    account: data?.account,
    confidence: Number(data?.confidence),
    reviewReason: data?.posted === true ? undefined : 'AI account selection needs review',
  };
}

/**
 * When an expense is recorded against a supplier we also create a matching
 * purchase_invoices header row so the spend surfaces in the Invoices list.
 * We intentionally skip invoice_items - the expense's own line items already
 * drive stock movements + purchases via trg_auto_create_purchase_from_expense,
 * and inserting invoice_items would double-create purchases via
 * trg_auto_create_purchases on invoice_items.
 */
export async function mirrorExpenseToInvoice(params: {
  expenseId: string;
  restaurantId: string;
  userId: string;
  supplierId?: string;
  total: number;
  invoiceDate: string;
  notes?: string;
  imageUrl?: string;
  status: 'paid' | 'unpaid';
  /**
   * When provided, each line is also written into invoice_items so the generated
   * supplier invoice shows the full itemized breakdown. Rows are inserted with
   * auto_create_purchase=false so the invoice_items trigger does NOT create
   * duplicate purchases (the expense already created them).
   */
  lineItems?: Array<{
    inventory_item_id: string;
    description: string;
    quantity: number;
    unit_cost: number;
  }>;
}) {
  if (!params.supplierId) return;
  try {
    const invoiceNumber = `EXP-${params.expenseId.slice(0, 8).toUpperCase()}`;
    const { data: invoice, error } = await db
      .from('purchase_invoices')
      .insert({
        restaurant_id: params.restaurantId,
        created_by: params.userId,
        supplier_id: params.supplierId,
        invoice_number: invoiceNumber,
        invoice_date: params.invoiceDate,
        subtotal: params.total,
        tax_amount: 0,
        total_amount: params.total,
        status: params.status === 'paid' ? 'paid' : 'pending',
        notes: params.notes
          ? `${params.notes}\n(Auto-generated from expense)`
          : 'Auto-generated from expense',
        image_url: params.imageUrl || null,
      })
      .select('id')
      .single();
    if (error) {
      console.error('Mirror invoice failed:', error);
      return;
    }
    if (invoice?.id) {
      await db
        .from('expenses')
        .update({ purchase_invoice_id: invoice.id })
        .eq('id', params.expenseId);

      // Mirror itemized lines into invoice_items (display-only - the trigger
      // skips these rows because auto_create_purchase=false). Written through
      // replace_invoice_items so lines are always replaced atomically and the
      // invoice total is recomputed server-side (direct writes are blocked).
      if (params.lineItems && params.lineItems.length > 0) {
        const rows = params.lineItems.map(li => ({
          inventory_item_id: li.inventory_item_id,
          description: li.description,
          quantity: li.quantity,
          unit_price: li.unit_cost,
          auto_create_purchase: false,
        }));
        const { error: itemsErr } = await (db as any).rpc('replace_invoice_items', {
          p_invoice_id: invoice.id,
          p_items: rows,
          p_auto_create_purchase: false,
        });
        if (itemsErr) {
          console.error('Mirror invoice items failed:', itemsErr);
        }
      }
    }
  } catch (e) {
    console.error('Mirror invoice failed (unexpected):', e);
  }
}

export function useExpenseApproval() {
  const { user, profile, restaurant, isManager, isOwner, isAccountant, hasRole } = useAuth();
  const queryClient = useQueryClient();
  const tenantId = profile?.tenant_id;
  const isCashierOnly = hasRole('cashier') && !isOwner && !isManager && !isAccountant;

  // Fetch pending expenses for approval queue
  const { data: pendingExpenses = [], isLoading: isPendingLoading } = useQuery({
    queryKey: ['expenses-pending-approval', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];

      const { data, error } = await db
        .from('expenses')
        .select(`
          *,
          expense_categories(id, name, color),
          account:chart_of_accounts!expenses_account_id_fkey(id, account_code, account_name, account_type)
        `)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .eq('approval_status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as ExpenseWithApproval[];
    },
    enabled: !!tenantId && (isManager || isOwner),
  });

  // Fetch all expenses with approval info
  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses-with-approval', restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];

      const { data, error } = await db
        .from('expenses')
        .select(`
          *,
          expense_categories(id, name, color),
          account:chart_of_accounts!expenses_account_id_fkey(id, account_code, account_name, account_type)
        `)
        .eq('restaurant_id', restaurant.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) throw error;
      return data as ExpenseWithApproval[];
    },
    enabled: !!restaurant?.id,
  });

  // Create expense and auto-post to ledger
  const createExpense = useMutation({
    mutationFn: async (data: CreateExpenseData) => {
      if (!restaurant?.id || !user?.id || !tenantId) {
        throw new Error('Authentication required');
      }

      // Itemized invoice path - multiple stock items on a single expense.
      // We validate first, then create the expense, then post each stock
      // movement atomically (rolling back the expense on the first failure).
      const lineItems = (data.line_items || []).filter(li => li.inventory_item_id && li.quantity > 0);
      const isItemized = lineItems.length > 0;

      if (isItemized) {
        if (!data.account_id) throw new Error('Chart of Accounts mapping is mandatory for expenses');
        if (!data.payment_method) throw new Error('Payment method is mandatory');
        if (!data.expense_date) throw new Error('Date is mandatory');
        // Sum line totals → drives the expense amount (ignore the form's amount field)
        const computedTotal = lineItems.reduce(
          (sum, li) => sum + (Number(li.quantity) * Number(li.unit_cost || 0)),
          0,
        );
        if (!(computedTotal > 0)) {
          throw new Error('Itemized invoice total must be greater than 0');
        }

        // Pre-fetch each inventory item once for stock + units_per_pack
        const sb = db as any;
        const itemIds = Array.from(new Set(lineItems.map(li => li.inventory_item_id)));
        const { data: items, error: itemsErr } = await sb
          .from('inventory_items')
          .select('id, current_stock, units_per_pack, name')
          .in('id', itemIds);
        if (itemsErr) throw itemsErr;
        const itemMap = new Map<string, { id: string; current_stock: number; units_per_pack: number; name: string }>();
        for (const it of items || []) {
          itemMap.set(it.id, {
            id: it.id,
            current_stock: Number(it.current_stock) || 0,
            units_per_pack: Number(it.units_per_pack) || 1,
            name: it.name,
          });
        }
        for (const li of lineItems) {
          if (!itemMap.has(li.inventory_item_id)) {
            throw new Error(`Inventory item not found for one of the line items`);
          }
        }

        // 1) Create expense (no inventory_item_id at the header - line items hold the link)
        const effectiveStatus = isCashierOnly ? 'unpaid' : data.status;

        const { data: expenseRow, error: expenseErr } = await db
          .from('expenses')
          .insert({
            restaurant_id: restaurant.id,
            tenant_id: tenantId,
            created_by: user.id,
            amount: Math.round(computedTotal * 100) / 100,
            description: data.description || null,
            category_id: data.category_id || null,
            expense_date: data.expense_date,
            receipt_url: data.receipt_url || null,
            status: effectiveStatus,
            account_id: data.account_id,
            payment_method: data.payment_method,
            funding_source: data.funding_source ?? 'company',
            payment_account_id: data.payment_account_id || null,
            capital_account_id: data.capital_account_id || null,
            approval_status: 'approved',
            approved_by: user.id,
            approved_at: new Date().toISOString(),
            inventory_item_id: null,
            quantity: null,
            supplier_id: data.supplier_id || null,
            is_inventory_item: true,
          })
          .select()
          .single();
        if (expenseErr) throw expenseErr;

        // 2) Post to ledger first so accounting reflects the total
        const { error: ledgerError } = await db.rpc('post_expense_to_ledger', {
          p_expense_id: expenseRow.id,
          p_account_id: data.account_id,
        });
        if (ledgerError) {
          console.error('Ledger posting error:', ledgerError);
          toast.error('Expense saved, but the accounting entry was not created', {
            description: ledgerError.message || 'Unknown posting error',
            duration: 10000,
          });
        }

        // 3) Apply each line as an atomic stock update + audit row.
        //    On the first failure we delete the expense to roll back.
        const movementsCreated: string[] = [];
        try {
          for (const li of lineItems) {
            const item = itemMap.get(li.inventory_item_id)!;
            const movementType: 'purchase' | 'usage' = li.movement_type ?? 'purchase';
            const baseDelta = li.stock_change_units != null && li.stock_change_units > 0
              ? Number(li.stock_change_units)
              : Number(li.quantity) * item.units_per_pack;
            if (!(baseDelta > 0)) {
              throw new Error(`Invalid stock delta for "${item.name}"`);
            }
            const signedDelta = movementType === 'purchase' ? baseDelta : -baseDelta;
            const stockBefore = item.current_stock;
            const stockAfter = stockBefore + signedDelta;

            // Atomic per-line update + insert
            const { error: stockError } = await db
              .from('inventory_items')
              .update({ current_stock: stockAfter, updated_at: new Date().toISOString() })
              .eq('id', item.id);
            if (stockError) throw stockError;

            const lineCost = Number(li.quantity) * Number(li.unit_cost || 0);
            const reasonParts = [
              li.movement_reason,
              data.description ? `Invoice: ${data.description}` : null,
              `Line: ${li.quantity} × ${li.unit_cost?.toFixed?.(2) ?? li.unit_cost} = ${lineCost.toFixed(2)}`,
            ].filter(Boolean);

            const { data: movRow, error: movementError } = await sb
              .from('stock_movements')
              .insert({
                tenant_id: tenantId,
                restaurant_id: restaurant.id,
                inventory_item_id: item.id,
                movement_type: movementType,
                quantity_change: signedDelta,
                stock_before: stockBefore,
                stock_after: stockAfter,
                reason: reasonParts.join(' - '),
                reference_type: 'expense',
                reference_id: expenseRow.id,
                created_by: user.id,
              })
              .select('id')
              .single();
            if (movementError) throw movementError;
            if (movRow?.id) movementsCreated.push(movRow.id);

            // Update local cache so subsequent lines for the same item compound correctly
            item.current_stock = stockAfter;
          }
        } catch (lineErr: any) {
          console.error('Line item failed - rolling back expense', lineErr);
          // Best-effort rollback: revert any stock updates we made and remove the expense.
          // (Movements rows reference the expense, so cascading by reference_id is enough
          // to keep the audit trail consistent: we delete movements + expense.)
          if (movementsCreated.length > 0) {
            await sb.from('stock_movements').delete().in('id', movementsCreated);
          }
          // Reverse stock for items we already touched
          for (const id of itemIds) {
            const item = itemMap.get(id);
            if (!item) continue;
            // Reset to the originally fetched value
            const original = (items || []).find((x: any) => x.id === id);
            if (original) {
              await db
                .from('inventory_items')
                .update({ current_stock: Number(original.current_stock) || 0, updated_at: new Date().toISOString() })
                .eq('id', id);
            }
          }
          await db.from('expenses').delete().eq('id', expenseRow.id);
          throw new Error(`Itemized invoice failed: ${lineErr.message || 'one line item could not be saved'}`);
        }

        // 4) Mirror to Invoices list when a supplier is selected.
        await mirrorExpenseToInvoice({
          expenseId: expenseRow.id,
          restaurantId: restaurant.id,
          userId: user.id,
          supplierId: data.supplier_id,
          total: Math.round(computedTotal * 100) / 100,
          invoiceDate: data.expense_date,
          notes: data.description,
          imageUrl: data.receipt_url,
          status: effectiveStatus,
          lineItems: lineItems.map(li => ({
            inventory_item_id: li.inventory_item_id,
            description: itemMap.get(li.inventory_item_id)?.name || 'Item',
            quantity: Number(li.quantity),
            unit_cost: Number(li.unit_cost || 0),
          })),
        });

        return expenseRow;
      }

      // Validate mandatory fields
      if (!data.account_id) {
        throw new Error('Chart of Accounts mapping is mandatory for expenses');
      }
      if (!data.payment_method) {
        throw new Error('Payment method is mandatory');
      }
      if (!data.amount || data.amount <= 0) {
        throw new Error('Valid amount is mandatory');
      }
      if (!data.expense_date) {
        throw new Error('Date is mandatory');
      }

      // Create expense with auto-approved status
      const effectiveStatus = isCashierOnly ? 'unpaid' : data.status;

      const { data: result, error } = await db
        .from('expenses')
        .insert({
          restaurant_id: restaurant.id,
          tenant_id: tenantId,
          created_by: user.id,
          amount: data.amount,
          vat_amount: data.vat_amount ?? 0,
          net_amount:
            data.net_amount ?? Math.round((data.amount - (data.vat_amount ?? 0)) * 100) / 100,
          vat_inclusive: data.vat_inclusive ?? true,
          vat_rate: data.vat_rate ?? null,
          description: data.description || null,
          category_id: data.category_id || null,
          expense_date: data.expense_date,
          receipt_url: data.receipt_url || null,
          status: effectiveStatus,
          account_id: data.account_id,
          payment_method: data.payment_method,
          funding_source: data.funding_source ?? 'company',
          payment_account_id: data.payment_account_id || null,
          capital_account_id: data.capital_account_id || null,
          approval_status: 'approved', // Auto-approved
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          inventory_item_id: data.inventory_item_id || null,
          quantity: data.quantity || null,
          supplier_id: data.supplier_id || null,
          ...(data.branch_id ? { branch_id: data.branch_id } : {}),
          ...(data.project_id ? { project_id: data.project_id } : {}),
          is_inventory_item: !!data.inventory_item_id,
        })
        .select()
        .single();

      if (error) throw error;

      // Auto-post to ledger
      const { error: ledgerError } = await db
        .rpc('post_expense_to_ledger', {
          p_expense_id: result.id,
          p_account_id: data.account_id,
        });

      if (ledgerError) {
        console.error('Ledger posting error:', ledgerError);
        // Don't throw - expense is still created, but show the real reason so
        // the user can fix it (missing account mapping, paying account, VAT...).
        toast.error('Expense saved, but the accounting entry was not created', {
          description: ledgerError.message || 'Unknown posting error',
          duration: 10000,
        });
      }

      // Adjust inventory stock if expense is linked to an inventory item
      if (data.inventory_item_id && data.quantity && data.quantity > 0) {
        const sb = db as any;
        const { data: item, error: fetchItemError } = await sb
          .from('inventory_items')
          .select('name, current_stock, units_per_pack')
          .eq('id', data.inventory_item_id)
          .single();

        if (!fetchItemError && item) {
          const movementType = data.movement_type ?? 'purchase';
          const unitsPerPack = Number(item.units_per_pack) || 1;
          // Stock-unit delta: explicit override, else quantity * units_per_pack
          const baseDelta = data.stock_change_units != null && data.stock_change_units > 0
            ? Number(data.stock_change_units)
            : Number(data.quantity) * unitsPerPack;
          const signedDelta = movementType === 'purchase' ? baseDelta : -baseDelta;
          const stockBefore = Number(item.current_stock);
          const stockAfter = stockBefore + signedDelta;

          const { error: stockError } = await db
            .from('inventory_items')
            .update({ current_stock: stockAfter, updated_at: new Date().toISOString() })
            .eq('id', data.inventory_item_id);

          if (stockError) {
            console.error('Stock update error:', stockError);
            const err = new Error(
              `Stock update failed for "${item.name}": ${stockError.message}. Expense was saved - please correct the inventory entry.`
            );
            (err as any).lineItemName = item.name;
            (err as any).lineItemId = data.inventory_item_id;
            (err as any).phase = 'stock_update';
            throw err;
          } else {
            // Log to stock_movements for full audit trail
            const { error: movementError } = await sb
              .from('stock_movements')
              .insert({
                tenant_id: tenantId,
                restaurant_id: restaurant.id,
                inventory_item_id: data.inventory_item_id,
                movement_type: movementType,
                quantity_change: signedDelta,
                stock_before: stockBefore,
                stock_after: stockAfter,
                reason: data.movement_reason || data.description || `Expense: ${data.payment_method}`,
                reference_type: 'expense',
                reference_id: result.id,
                created_by: user.id,
              });
            if (movementError) {
              console.error('Stock movement log error:', movementError);
              const err = new Error(
                `Stock movement audit log failed for "${item.name}": ${movementError.message}. Stock was updated but the audit trail entry is missing.`
              );
              (err as any).lineItemName = item.name;
              (err as any).lineItemId = data.inventory_item_id;
              (err as any).phase = 'movement_log';
              throw err;
            }
          }
        } else if (fetchItemError) {
          throw new Error(
            `Could not load linked inventory item: ${fetchItemError.message}. Expense was saved without stock adjustment - please review the item selection.`
          );
        }
      }

      // Mirror to Invoices list when a supplier is selected.
      await mirrorExpenseToInvoice({
        expenseId: result.id,
        restaurantId: restaurant.id,
        userId: user.id,
        supplierId: data.supplier_id,
        total: data.amount,
        invoiceDate: data.expense_date,
        notes: data.description,
        imageUrl: data.receipt_url,
        status: effectiveStatus,
      });

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-with-approval'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-pending-approval'] });
      queryClient.invalidateQueries({ queryKey: ['account-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items-expense'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Expense recorded and posted to ledger');
    },
    onError: (error: Error) => {
      const lineItemName = (error as any).lineItemName as string | undefined;
      const phase = (error as any).phase as string | undefined;
      if (lineItemName) {
        toast.error(`Problem with "${lineItemName}"`, {
          description: error.message,
          duration: 8000,
          action: {
            label: 'Dismiss',
            onClick: () => {},
          },
        });
      } else {
        const parsed = parseLedgerValidationError(error);
        if (parsed.isLedgerValidation) {
          const leg = parsed.legSide
            ? `${parsed.legSide === 'debit' ? 'DR' : 'CR'} ${parsed.accountCode ?? ''}${parsed.accountName ? ` · ${parsed.accountName}` : ''}`.trim()
            : null;
          toast.error(
            leg ? `Ledger rejected the ${leg} leg` : 'Ledger rejected this posting',
            {
              description: [parsed.ruleName, parsed.detail, parsed.fix]
                .filter(Boolean)
                .join(' — '),
              duration: 12000,
            },
          );
        } else {
          toast.error('Could not record expense', {
            description: error.message,
            duration: 7000,
          });
        }
      }
      // Always invalidate so any partial state (saved expense, updated stock) is reflected
      // and the form can be corrected against the real backend state.
      queryClient.invalidateQueries({ queryKey: ['inventory-items-expense'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-with-approval'] });
    },
  });

  // Approve expense
  const approveExpense = useMutation({
    mutationFn: async ({
      expenseId,
      paymentAccountId,
    }: { expenseId: string; postToLedger?: boolean; paymentAccountId?: string | null }) => {
      if (!user?.id) throw new Error('Authentication required');
      if (!isManager && !isOwner) throw new Error('Manager or Owner role required');
      return approveAndPostExpenseWithAi(expenseId, paymentAccountId);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-with-approval'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-pending-approval'] });
      queryClient.invalidateQueries({ queryKey: ['account-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance'] });
      queryClient.invalidateQueries({ queryKey: ['profit-loss'] });
      if (result.posted) {
        const account = result.account ? `${result.account.code} · ${result.account.name}` : undefined;
        toast.success(result.alreadyPosted ? 'Expense was already posted' : 'Expense approved and posted automatically', {
          description: account
            ? `${account}${Number.isFinite(result.confidence) ? ` · ${Math.round((result.confidence ?? 0) * 100)}% confidence` : ''}`
            : undefined,
        });
      } else {
        toast.warning('Expense approved — ledger posting needs review', {
          description: result.reviewReason,
          duration: 10000,
        });
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to approve: ${error.message}`);
    },
  });

  // Reject expense
  const rejectExpense = useMutation({
    mutationFn: async ({ expenseId, reason }: { expenseId: string; reason: string }) => {
      if (!user?.id) throw new Error('Authentication required');
      if (!isManager && !isOwner) throw new Error('Manager or Owner role required');
      if (!reason.trim()) throw new Error('Rejection reason is mandatory');

      const { error } = await db
        .from('expenses')
        .update({
          approval_status: 'rejected',
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          rejection_reason: reason,
        })
        .eq('id', expenseId);

      if (error) throw error;
      return { expenseId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-with-approval'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-pending-approval'] });
      toast.success('Expense rejected');
    },
    onError: (error: Error) => {
      toast.error(`Failed to reject: ${error.message}`);
    },
  });

  // Bulk approve
  const bulkApprove = useMutation({
    mutationFn: async (input: string[] | { expenseIds: string[]; paymentAccountId?: string | null }) => {
      const expenseIds = Array.isArray(input) ? input : input.expenseIds;
      const paymentAccountId = Array.isArray(input) ? undefined : input.paymentAccountId;
      if (!user?.id) throw new Error('Authentication required');
      if (!isManager && !isOwner) throw new Error('Manager or Owner role required');
      let posted = 0;
      const review: Array<{ expenseId: string; reason: string }> = [];
      const failed: Array<{ expenseId: string; reason: string }> = [];
      for (const expenseId of expenseIds) {
        try {
          const result = await approveAndPostExpenseWithAi(expenseId, paymentAccountId);
          if (result.posted) posted += 1;
          else review.push({ expenseId, reason: result.reviewReason || 'AI account selection needs review' });
        } catch (error) {
          failed.push({
            expenseId,
            reason: error instanceof Error ? error.message : 'Approval failed',
          });
        }
      }
      return { approved: posted + review.length, posted, review, failed };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-with-approval'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-pending-approval'] });
      queryClient.invalidateQueries({ queryKey: ['account-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance'] });
      queryClient.invalidateQueries({ queryKey: ['profit-loss'] });
      if (data.review.length === 0 && data.failed.length === 0) {
        toast.success(`${data.posted} expenses approved and posted automatically`);
      } else {
        toast.warning(`${data.approved} approved · ${data.posted} posted · ${data.review.length} need review`, {
          description: [...data.review, ...data.failed].slice(0, 3).map((item) => item.reason).join(' · '),
          duration: 12000,
        });
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to bulk approve: ${error.message}`);
    },
  });

  return {
    expenses,
    pendingExpenses,
    isLoading,
    isPendingLoading,
    createExpense,
    approveExpense,
    rejectExpense,
    bulkApprove,
    canApprove: isManager || isOwner,
  };
}
