import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/**
 * Background posting jobs (bulk_post + auto_reconcile).
 *
 * - `useEnqueuePostingJob` creates the job row via the `enqueue_posting_job`
 *   RPC (role-gated server-side) and kicks the `process-posting-job` edge
 *   function to start chewing through it.
 * - `usePostingJobs` lists recent jobs for the active scope and subscribes
 *   to realtime updates so the UI progress bar moves without polling.
 * - `resumePostingJob` re-invokes the worker against an interrupted job.
 */

export type PostingJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface PostingJob {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  job_type: "bulk_post" | "auto_reconcile";
  status: PostingJobStatus;
  expense_ids: string[];
  total: number;
  processed: number;
  posted: number;
  skipped: number;
  failed: number;
  fixed: number;
  manual_review: number;
  current_expense_id: string | null;
  last_error: string | null;
  details: any;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

async function invokeWorker(jobId: string) {
  const { data, error } = await db.functions.invoke("process-posting-job", {
    body: { job_id: jobId },
  });
  if (error) throw error;
  return data;
}

export function useEnqueuePostingJob() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      branchId: string | null;
      jobType: "bulk_post" | "auto_reconcile";
      expenseIds: string[];
    }) => {
      if (!tenantId) throw new Error("No active tenant");
      if (vars.expenseIds.length === 0) throw new Error("No entries to process");
      const { data: jobId, error } = await (db as any).rpc(
        "enqueue_posting_job",
        {
          p_tenant_id: tenantId,
          p_branch_id: vars.branchId,
          p_job_type: vars.jobType,
          p_expense_ids: vars.expenseIds,
        }
      );
      if (error) throw error;
      // Fire-and-forget; the worker checkpoints to the row so realtime
      // updates the UI even if this invocation times out.
      invokeWorker(jobId).catch((e) =>
        console.warn("[posting-job] worker invocation error", e)
      );
      return jobId as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["posting-jobs"] });
      toast.success("Background job started — you'll be notified when it finishes.");
    },
    onError: (e: any) =>
      toast.error("Failed to start background job", { description: e?.message }),
  });
}

export async function resumePostingJob(jobId: string) {
  return invokeWorker(jobId);
}

export function usePostingJobs(branchId: string | null, limit = 10) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const qc = useQueryClient();

  const query = useQuery<PostingJob[]>({
    queryKey: ["posting-jobs", tenantId, branchId, limit],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = (db as any)
        .from("posting_jobs")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PostingJob[];
    },
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!tenantId) return;
    const channel = (db as any)
      .channel(`posting-jobs:${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "posting_jobs",
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["posting-jobs"] });
          qc.invalidateQueries({ queryKey: ["unposted-expenses"] });
          qc.invalidateQueries({ queryKey: ["imbalanced-expenses"] });
          qc.invalidateQueries({ queryKey: ["posting-audit"] });
        }
      )
      .subscribe();
    return () => {
      (db as any).removeChannel(channel);
    };
  }, [tenantId, qc]);

  return query;
}