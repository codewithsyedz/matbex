import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { toast } from "sonner";
import {
  createJournalEntry as apiCreateJournalEntry,
  reverseJournalEntry as apiReverseJournalEntry,
  voidJournalEntry as apiVoidJournalEntry,
} from "@/lib/api/ledger";

export interface JournalEntryBatch {
  id: string;
  tenant_id: string;
  batch_date: string;
  description: string;
  reference_number: string | null;
  entry_type: string;
  created_by: string;
  created_at: string;
  branch_id: string | null;
  is_posted: boolean;
  posted_at: string | null;
  posted_by: string | null;
  approval_status: "pending" | "approved" | "rejected";
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  pending_lines: unknown;
}

export interface JournalEntryLine {
  account_id: string;
  account_code?: string;
  account_name?: string;
  debit?: number;
  credit?: number;
  description?: string;
}

export interface CreateJournalEntryData {
  batch_date?: string;
  description: string;
  reference_number?: string;
  entry_type: "adjustment" | "correction" | "reversal" | "opening_balance";
  lines: JournalEntryLine[];
  /** Branch this entry belongs to. Defaults to the active branch. */
  branch_id?: string | null;
}

export function useJournalEntries() {
  const { user, profile, restaurant } = useAuth();
  const { activeBranchId, pinnedBranchId, isAllBranches } = useBranch();
  const queryClient = useQueryClient();
  const currentApproveBatchIdRef = useRef<string | null>(null);
  const tenantId = profile?.tenant_id;
  const scopedBranchId = pinnedBranchId ?? (isAllBranches ? null : activeBranchId ?? null);

  // Fetch journal entry batches
  const { data: batches = [], isLoading: batchesLoading } = useQuery({
    queryKey: ["journal-entry-batches", tenantId, scopedBranchId ?? "all"],
    queryFn: async () => {
      if (!tenantId) return [];

      let q = db
        .from("journal_entry_batches")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        // Main Branch alone has ~470 batches; a low cap silently under-counts
        // the pending list in branch and consolidated views.
        .limit(2000);
      // Branch-scoped view: strictly this branch's entries.
      if (scopedBranchId) {
        q = q.eq("branch_id", scopedBranchId);
      }
      const { data, error } = await q;

      if (error) throw error;
      return data as JournalEntryBatch[];
    },
    enabled: !!tenantId,
  });

  // Realtime: refresh the batch list as entries are submitted/approved/rejected.
  useEffect(() => {
    if (!tenantId) return;
    const channel = db
      .channel(`journal-entry-batches-${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "journal_entry_batches",
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["journal-entry-batches"] });
        }
      )
      .subscribe();

    return () => {
      db.removeChannel(channel);
    };
  }, [tenantId, queryClient]);

  // Create a journal entry batch with lines
  const createJournalEntry = useMutation({
    mutationFn: async (data: CreateJournalEntryData) => {
      if (!tenantId || !user?.id || !restaurant?.id) {
        throw new Error("Authentication required");
      }
      if (data.lines.length < 2) {
        throw new Error("Journal entry must have at least 2 lines (debit and credit).");
      }
      // The server checks balance, accounts, branch and period, then posts (owner/manager)
      // or queues the entry for approval (accountant), all in one transaction.
      const result = await apiCreateJournalEntry({
        restaurantId: restaurant.id,
        date: data.batch_date || new Date().toISOString().split("T")[0],
        description: data.description,
        entryType: data.entry_type,
        referenceNumber: data.reference_number ?? null,
        branchId: data.branch_id ?? scopedBranchId ?? null,
        lines: data.lines.map((l) => ({
          accountId: l.account_id,
          debit: l.debit || null,
          credit: l.credit || null,
          description: l.description || null,
        })),
      });
      return { id: result.id, pending: result.status === "pending" };
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["journal-entry-batches"] });
      queryClient.invalidateQueries({ queryKey: ["account-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      if (result && (result as any).pending) {
        toast.success("Journal entry submitted for approval", {
          description: "An owner or manager must approve it before it posts to the ledger.",
        });
      } else {
        toast.success("Journal entry created successfully");
      }
    },
    onError: (error: Error) => {
      const message = error.message.includes("VALIDATION_ERROR")
        ? error.message.replace("VALIDATION_ERROR: ", "")
        : error.message;
      toast.error("Failed to create journal entry", { description: message });
    },
  });

  // Approve a pending batch (owner/manager only)
  const approveBatch = useMutation({
    mutationFn: async (batchId: string) => {
      currentApproveBatchIdRef.current = batchId;
      const { data, error } = await db.rpc("approve_journal_entry", {
        p_batch_id: batchId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      currentApproveBatchIdRef.current = null;
      queryClient.invalidateQueries({ queryKey: ["journal-entry-batches"] });
      queryClient.invalidateQueries({ queryKey: ["account-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      toast.success("Journal entry approved and posted");
    },
    onError: (error: Error) => {
      const isAlreadyPosted = error.message.toLowerCase().includes("no lines to post");
      if (isAlreadyPosted) {
        const batchId = currentApproveBatchIdRef.current;
        toast.info("Already posted; review only", {
          description:
            "This batch was written straight to the ledger by the source poster. No further posting is needed — just acknowledge it to clear the pending flag.",
          action: batchId
            ? {
                label: "Acknowledge",
                onClick: () => acknowledgeBatch.mutate(batchId),
              }
            : undefined,
        });
      } else {
        toast.error("Failed to approve entry", { description: error.message });
      }
      currentApproveBatchIdRef.current = null;
    },
  });

  // Reject a pending batch (owner/manager only)
  // Acknowledge a batch that was already written straight to the ledger by a
  // direct poster: clears pending status without re-posting anything.
  const acknowledgeBatch = useMutation({
    mutationFn: async (batchId: string) => {
      const { data, error } = await db.rpc("acknowledge_posted_journal_entry" as any, {
        p_batch_id: batchId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal-entry-batches"] });
      toast.success("Entry acknowledged", {
        description: "Pending status cleared — the ledger was not changed.",
      });
    },
    onError: (error: Error) => {
      toast.error("Failed to acknowledge entry", { description: error.message });
    },
  });

  const rejectBatch = useMutation({
    mutationFn: async ({ batchId, reason }: { batchId: string; reason: string }) => {
      const { data, error } = await db.rpc("reject_journal_entry", {
        p_batch_id: batchId,
        p_reason: reason,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal-entry-batches"] });
      toast.success("Journal entry rejected");
    },
    onError: (error: Error) => {
      toast.error("Failed to reject entry", { description: error.message });
    },
  });

  // Void a transaction (soft delete with reversing entry)
  // Bulk approve / reject — runs sequentially so one failure doesn't abort the rest.
  const bulkApproveBatches = useMutation({
    mutationFn: async (batchIds: string[]) => {
      const failed: { id: string; message: string }[] = [];
      let succeeded = 0;
      for (const id of batchIds) {
        const { error } = await db.rpc("approve_journal_entry", { p_batch_id: id });
        if (error) failed.push({ id, message: error.message });
        else succeeded += 1;
      }
      return { succeeded, failed };
    },
    onSuccess: ({ succeeded, failed }) => {
      queryClient.invalidateQueries({ queryKey: ["journal-entry-batches"] });
      queryClient.invalidateQueries({ queryKey: ["account-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      if (succeeded > 0) {
        toast.success(`${succeeded} ${succeeded === 1 ? "entry" : "entries"} approved and posted`);
      }
      if (failed.length > 0) {
        toast.error(`${failed.length} could not be approved`, {
          description: failed[0].message,
        });
      }
    },
    onError: (error: Error) => {
      toast.error("Bulk approve failed", { description: error.message });
    },
  });

  const bulkRejectBatches = useMutation({
    mutationFn: async ({ batchIds, reason }: { batchIds: string[]; reason: string }) => {
      const failed: { id: string; message: string }[] = [];
      let succeeded = 0;
      for (const id of batchIds) {
        const { error } = await db.rpc("reject_journal_entry", {
          p_batch_id: id,
          p_reason: reason,
        });
        if (error) failed.push({ id, message: error.message });
        else succeeded += 1;
      }
      return { succeeded, failed };
    },
    onSuccess: ({ succeeded, failed }) => {
      queryClient.invalidateQueries({ queryKey: ["journal-entry-batches"] });
      if (succeeded > 0) {
        toast.success(`${succeeded} ${succeeded === 1 ? "entry" : "entries"} rejected`);
      }
      if (failed.length > 0) {
        toast.error(`${failed.length} could not be rejected`, {
          description: failed[0].message,
        });
      }
    },
    onError: (error: Error) => {
      toast.error("Bulk reject failed", { description: error.message });
    },
  });

  // Void a whole manual entry (all its lines) while its period is open. Owner/manager only.
  const voidEntry = useMutation({
    mutationFn: async ({ batchId, reason }: { batchId: string; reason: string }) => {
      if (!restaurant?.id) throw new Error("Authentication required");
      return apiVoidJournalEntry(batchId, { restaurantId: restaurant.id, reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal-entry-batches"] });
      queryClient.invalidateQueries({ queryKey: ["account-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      toast.success("Journal entry voided");
    },
    onError: (error: Error) => {
      toast.error("Could not void the entry", { description: error.message });
    },
  });

  // Post a mirror entry in an open period (for entries in a locked period). Owner/manager only.
  const reverseEntry = useMutation({
    mutationFn: async ({ batchId, reason, date }: { batchId: string; reason: string; date?: string }) => {
      if (!restaurant?.id) throw new Error("Authentication required");
      return apiReverseJournalEntry(batchId, { restaurantId: restaurant.id, reason, date });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["journal-entry-batches"] });
      queryClient.invalidateQueries({ queryKey: ["account-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      toast.success("Reversing entry posted", { description: `Dated ${result.date}` });
    },
    onError: (error: Error) => {
      toast.error("Could not reverse the entry", { description: error.message });
    },
  });

  return {
    batches,
    isLoading: batchesLoading,
    createJournalEntry,
    voidEntry,
    reverseEntry,
    isCreating: createJournalEntry.isPending,
    isVoiding: voidEntry.isPending || reverseEntry.isPending,
    approveBatch,
    rejectBatch,
    acknowledgeBatch,
    bulkApproveBatches,
    bulkRejectBatches,
  };
}
