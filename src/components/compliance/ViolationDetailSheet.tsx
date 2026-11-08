import { useRef, useState } from "react";
import { format } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Camera, Repeat, Trash2, Upload } from "lucide-react";
import {
  COMPLIANCE_SOURCE_LABELS,
  COMPLIANCE_STATUS_FLOW,
  COMPLIANCE_STATUS_LABELS,
  useRepeatInfo,
  useViolationTimeline,
  type ComplianceStatus,
  type ComplianceViolation,
} from "@/hooks/useComplianceViolations";
import {
  openComplianceFile,
  useComplianceEvidence,
  type EvidencePhase,
} from "@/hooks/useComplianceEvidence";
import { useCurrency } from "@/hooks/useCurrency";

interface Props {
  violation: ComplianceViolation | null;
  onOpenChange: (v: boolean) => void;
  onChangeStatus: (id: string, status: ComplianceStatus) => void;
  onCreateFine?: (violation: ComplianceViolation) => void;
}

export function ViolationDetailSheet({ violation, onOpenChange, onChangeStatus, onCreateFine }: Props) {
  const { format: money } = useCurrency();
  const { data: timeline = [] } = useViolationTimeline(violation?.id);
  const { data: repeat } = useRepeatInfo(violation?.id);
  const { before, after, upload, remove } = useComplianceEvidence(violation?.id);
  const [phase, setPhase] = useState<EvidencePhase>("before");
  const fileRef = useRef<HTMLInputElement>(null);

  if (!violation) return null;

  const nextStatus = (() => {
    const idx = COMPLIANCE_STATUS_FLOW.indexOf(violation.status);
    return idx >= 0 && idx < COMPLIANCE_STATUS_FLOW.length - 1
      ? COMPLIANCE_STATUS_FLOW[idx + 1]
      : null;
  })();

  const pickFiles = (p: EvidencePhase) => {
    setPhase(p);
    fileRef.current?.click();
  };

  const photoBlock = (label: string, rows: typeof before, p: EvidencePhase) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        <Button variant="outline" size="sm" onClick={() => pickFiles(p)}>
          <Upload className="mr-2 h-3.5 w-3.5" /> Add
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No photos yet.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs">
              <button
                className="truncate text-left hover:underline"
                onClick={() => openComplianceFile(r.storage_path)}
              >
                <Camera className="mr-1.5 inline h-3 w-3" />
                {r.caption || "Photo"}
              </button>
              <span className="ml-2 shrink-0 text-muted-foreground">
                {format(new Date(r.uploaded_at), "dd MMM HH:mm")}
              </span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => remove.mutate(r)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Sheet open={!!violation} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-hidden p-0 sm:max-w-xl">
        <ScrollArea className="h-full">
          <div className="space-y-5 p-6">
            <SheetHeader className="space-y-1 text-left">
              <SheetTitle className="flex items-center gap-2">
                {violation.violation_number ?? "Violation"}
                <Badge variant={violation.is_municipality_fine ? "destructive" : "secondary"}>
                  {violation.is_municipality_fine ? "Municipality fine" : "Internal SOP"}
                </Badge>
              </SheetTitle>
              <SheetDescription>
                {violation.branch?.name} · {violation.violation_type?.name_en ?? "—"} ·{" "}
                {format(new Date(violation.violation_date), "dd MMM yyyy")}
              </SheetDescription>
            </SheetHeader>

            {violation.is_overdue ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Corrective action overdue</AlertTitle>
                <AlertDescription>
                  Due {violation.corrective_action_due_date} — the branch manager has been notified.
                </AlertDescription>
              </Alert>
            ) : null}

            {repeat && repeat.occurrences > 0 ? (
              <Alert>
                <Repeat className="h-4 w-4" />
                <AlertTitle>Repeated violation</AlertTitle>
                <AlertDescription className="space-y-1 text-xs">
                  <p>Previous occurrences at this branch: {repeat.occurrences}</p>
                  {repeat.last_occurrence ? <p>Last occurrence: {repeat.last_occurrence}</p> : null}
                  {repeat.recommended_action ? (
                    <p>Configured recommended action: <strong>{repeat.recommended_action}</strong></p>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base font-medium">Details</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <Detail label="Status" value={COMPLIANCE_STATUS_LABELS[violation.status]} />
                <Detail label="Source" value={COMPLIANCE_SOURCE_LABELS[violation.source]} />
                <Detail label="Category" value={violation.category?.name_en ?? "—"} />
                <Detail label="Severity" value={violation.violation_type?.severity ?? "—"} />
                <Detail label="Responsible" value={violation.responsible_staff?.name ?? "Not attributed"} />
                <Detail label="Supervisor" value={violation.supervisor_staff?.name ?? "—"} />
                <Detail label="Fine amount" value={money(Number(violation.fine_amount || 0))} />
                <Detail label="Municipality ref" value={violation.municipality_reference ?? "—"} />
                <Detail label="Inspector" value={violation.inspector_name ?? "—"} />
                <Detail label="Due date" value={violation.corrective_action_due_date ?? "—"} />
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p>{violation.description || "—"}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Corrective action</p>
                  <p>{violation.corrective_action_required || "—"}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base font-medium">Evidence</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {photoBlock("Before corrective action", before, "before")}
                <Separator />
                {photoBlock("After corrective action", after, "after")}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length) upload.mutate({ files, phase });
                    e.target.value = "";
                  }}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base font-medium">Workflow</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {nextStatus ? (
                    <Button size="sm" onClick={() => onChangeStatus(violation.id, nextStatus)}>
                      Move to {COMPLIANCE_STATUS_LABELS[nextStatus]}
                    </Button>
                  ) : null}
                  {violation.status !== "cancelled" && violation.status !== "closed" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onChangeStatus(violation.id, "cancelled")}
                    >
                      Cancel violation
                    </Button>
                  ) : null}
                  {violation.is_municipality_fine && onCreateFine ? (
                    <Button size="sm" variant="secondary" onClick={() => onCreateFine(violation)}>
                      Register municipality fine
                    </Button>
                  ) : null}
                </div>

                <Separator />
                <ol className="space-y-2 text-xs">
                  {timeline.map((t: Record<string, unknown>) => (
                    <li key={String(t.id)} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <div>
                        <p className="font-medium">
                          {COMPLIANCE_STATUS_LABELS[t.to_status as ComplianceStatus] ?? String(t.to_status)}
                        </p>
                        <p className="text-muted-foreground">
                          {format(new Date(String(t.created_at)), "dd MMM yyyy HH:mm")}
                          {t.comment ? ` — ${String(t.comment)}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            <Alert>
              <AlertTitle className="text-sm">Payroll separation</AlertTitle>
              <AlertDescription className="text-xs">
                This record does not deduct anything from an employee. Any wage deduction must be raised
                separately in Team → Fines &amp; Deductions and pass its own approval and cap checks.
              </AlertDescription>
            </Alert>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}