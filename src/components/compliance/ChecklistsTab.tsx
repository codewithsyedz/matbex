import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardCheck, Info } from "lucide-react";
import {
  CHECKLIST_KIND_LABELS,
  useChecklistRun,
  useChecklistTemplates,
  type ChecklistItem,
} from "@/hooks/useComplianceChecklists";

interface Props {
  branchId: string | null;
  branchName: string;
  canReview: boolean;
}

export function ChecklistsTab({ branchId, branchName, canReview }: Props) {
  const { templates, items, isLoading } = useChecklistTemplates();
  const [runDate, setRunDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [templateId, setTemplateId] = useState<string | null>(null);

  const activeTemplate = templates.find((t) => t.id === templateId) ?? templates[0] ?? null;
  const { run, runItems, toggleItem, markCompleted, markReviewed, approve } = useChecklistRun(
    activeTemplate?.id ?? null,
    runDate,
  );

  const [reviewComment, setReviewComment] = useState("");
  const [signature, setSignature] = useState("");

  const templateItems: ChecklistItem[] = useMemo(
    () => items.filter((i) => i.template_id === activeTemplate?.id),
    [items, activeTemplate?.id],
  );

  const checkedIds = new Set(runItems.filter((r) => r.is_checked).map((r) => r.item_id));
  const completion = templateItems.length
    ? Math.round((checkedIds.size / templateItems.length) * 100)
    : 0;

  if (!branchId) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Select a branch</AlertTitle>
        <AlertDescription>Daily checklists are filled per branch. Pick a branch above.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Daily compliance checklist</CardTitle>
          <CardDescription>
            {branchName} — opening, during-shift and closing checks with supervisor review and manager
            approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Date</Label>
            <Input type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Checklist</Label>
            <Select value={activeTemplate?.id ?? ""} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder="Select checklist" /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {CHECKLIST_KIND_LABELS[t.kind]} — {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Progress</Label>
            <div className="flex h-10 items-center gap-2">
              <Badge variant={completion === 100 ? "secondary" : "outline"}>{completion}%</Badge>
              {run?.completed_at ? <Badge variant="secondary">Submitted</Badge> : null}
              {run?.reviewed_at ? <Badge variant="secondary">Reviewed</Badge> : null}
              {run?.approved_at ? <Badge>Approved</Badge> : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading checklists…</p>
      ) : !activeTemplate ? (
        <Alert>
          <ClipboardCheck className="h-4 w-4" />
          <AlertTitle>No checklist templates yet</AlertTitle>
          <AlertDescription>Seed the compliance defaults from the Settings tab to get started.</AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardContent className="pt-6 space-y-2">
            {templateItems.map((item) => {
              const locked = !!run?.approved_at;
              return (
                <label
                  key={item.id}
                  className="flex items-start gap-3 rounded-md border p-3 text-sm"
                >
                  <Checkbox
                    checked={checkedIds.has(item.id)}
                    disabled={locked}
                    onCheckedChange={(v) =>
                      toggleItem.mutate({ itemId: item.id, checked: Boolean(v) })
                    }
                  />
                  <div>
                    <p className="font-medium">{item.label_en}</p>
                    {item.requires_photo ? (
                      <p className="text-xs text-muted-foreground">Photo evidence recommended</p>
                    ) : null}
                  </div>
                </label>
              );
            })}

            <Separator className="my-3" />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={!!run?.completed_at || completion === 0}
                onClick={() => markCompleted.mutate(null)}
              >
                Submit for review
              </Button>
              {canReview ? (
                <>
                  <Input
                    className="h-9 w-56"
                    placeholder="Review comments"
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!run?.completed_at || !!run?.reviewed_at}
                    onClick={() => markReviewed.mutate(reviewComment)}
                  >
                    Record supervisor review
                  </Button>
                  <Input
                    className="h-9 w-48"
                    placeholder="Manager signature"
                    value={signature}
                    onChange={(e) => setSignature(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!run?.reviewed_at || !!run?.approved_at || !signature}
                    onClick={() => approve.mutate({ signature, comments: reviewComment })}
                  >
                    Approve &amp; lock
                  </Button>
                </>
              ) : null}
            </div>

            {run?.review_comments ? (
              <Textarea readOnly value={run.review_comments} className="mt-2 text-xs" rows={2} />
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}