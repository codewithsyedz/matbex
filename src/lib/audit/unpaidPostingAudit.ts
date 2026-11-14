import { db } from "@/integrations/db/client";

export type UnpaidPostingEvent =
  | "attempted"
  | "queued_offline"
  | "succeeded"
  | "failed";

export interface LogUnpaidPostingArgs {
  event: UnpaidPostingEvent;
  restaurantId: string | null | undefined;
  branchId?: string | null;
  userId?: string | null;
  customerId?: string | null;
  receiptNumber?: string | null;
  cartTotal?: number | null;
  errorMessage?: string | null;
  errorDetails?: unknown;
}

/**
 * Best-effort audit logger for unpaid (customer-tab) sale postings.
 * Never throws - auditing must not block the POS flow.
 */
export async function logUnpaidPosting(args: LogUnpaidPostingArgs): Promise<void> {
  if (!args.restaurantId) return;
  try {
    const isOnline =
      typeof navigator !== "undefined" ? navigator.onLine !== false : null;

    let errorDetails: Record<string, unknown> | null = null;
    if (args.errorDetails != null) {
      if (args.errorDetails instanceof Error) {
        errorDetails = {
          name: args.errorDetails.name,
          message: args.errorDetails.message,
          stack: args.errorDetails.stack,
        };
      } else if (typeof args.errorDetails === "object") {
        try {
          errorDetails = JSON.parse(JSON.stringify(args.errorDetails));
        } catch {
          errorDetails = { raw: String(args.errorDetails) };
        }
      } else {
        errorDetails = { raw: String(args.errorDetails) };
      }
    }

    await (db as unknown as {
      from: (t: string) => {
        insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
      };
    })
      .from("unpaid_posting_audit")
      .insert({
        restaurant_id: args.restaurantId,
        branch_id: args.branchId ?? null,
        user_id: args.userId ?? null,
        customer_id: args.customerId ?? null,
        event: args.event,
        receipt_number: args.receiptNumber ?? null,
        cart_total: args.cartTotal ?? null,
        error_message: args.errorMessage ?? null,
        error_details: errorDetails,
        is_online: isOnline,
      });
  } catch (err) {
    // Swallow - audit failures must never break the sale UX.
    console.warn("[unpaid-audit] failed to log", args.event, err);
  }
}