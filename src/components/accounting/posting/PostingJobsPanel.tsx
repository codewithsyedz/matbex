import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Loader2,
  PlayCircle,
  RotateCw,
  XCircle,
} from "lucide-react";
import { resumePostingJob, usePostingJobs } from "@/hooks/usePostingJobs";
import { useState } from "react";
import { toast } from "sonner";

interface Props {
  branchId: string | null;
}

export function PostingJobsPanel({ branchId }: Props) {
  const { data: jobs = [], isLoading } = usePostingJobs(branchId);
  const [resumingId, setResumingId] = useState<string | null>(null);

  if (isLoading) return null;
  if (jobs.length === 0) return null;

  const handleResume = async (id: string) => {
    setResumingId(id);
    try {
      await resumePostingJob(id);
      toast.success("Resumed — processing continues in the background.");
    } catch (e: any) {
      toast.error("Resume failed", { description: e?.message });
    } finally {
      setResumingId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Background jobs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {jobs.map((j) => {
          const pct = j.total === 0 ? 0 : Math.round((j.processed / j.total) * 100);
          const isTerminal =
            j.status === "completed" || j.status === "failed" || j.status === "cancelled";
          const isInterrupted =
            (j.status === "running" || j.status === "queued") &&
            j.processed < j.total &&
            Date.now() - new Date(j.updated_at).getTime() > 60_000;
          return (
            <div key={j.id} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  {j.status === "completed" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : j.status === "failed" || j.status === "cancelled" ? (
                    <XCircle className="h-4 w-4 text-destructive" />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  <span className="font-medium">
                    {j.job_type === "bulk_post" ? "Bulk post" : "Auto-reconcile"}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {j.status}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(j.created_at).toLocaleString()}
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {j.processed}/{j.total} processed
                  </span>
                  <span>
                    {j.job_type === "bulk_post"
                      ? `${j.posted} posted · ${j.skipped} skipped · ${j.failed} failed`
                      : `${j.fixed} fixed · ${j.manual_review} review · ${j.failed} failed`}
                  </span>
                </div>
                <Progress value={pct} />
              </div>
              {j.last_error && (
                <div className="text-[11px] text-rose-600 truncate" title={j.last_error}>
                  Last error: {j.last_error}
                </div>
              )}
              {!isTerminal && isInterrupted && (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resumingId === j.id}
                    onClick={() => handleResume(j.id)}
                  >
                    {resumingId === j.id ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <PlayCircle className="h-3.5 w-3.5 mr-1" />
                    )}
                    Resume
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}