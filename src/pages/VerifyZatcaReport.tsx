import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ShieldAlert, CheckCircle2, Circle, Loader2, ArrowLeft, Clock } from "lucide-react";
import { format } from "date-fns";
import { differenceInDays } from "date-fns";

interface SnapshotPayload {
  tenantName: string;
  generatedAt: string;
  seller: {
    name_en: string | null;
    name_ar: string | null;
    vat_registration_number: string | null;
    zatca_phase_mode: string | null;
    pdf_generation_mode: string | null;
  };
  steps: Array<{ id: string; title: string; state: "done" | "pending" | "todo" }>;
  devices: Array<{
    name: string;
    serial_number: string;
    registration_status: string;
    icv_counter: number;
    compliance_csid_issued: boolean;
    production_csid_issued: boolean;
    compliance_passed_at: string | null;
    csid_expires_at: string | null;
  }>;
  metrics: {
    total: number;
    cleared: number;
    reported: number;
    pending: number;
    rejected: number;
    schemaInvalid: number;
    successRate: number;
    avgLatencyMs: number | null;
  } | null;
}

interface VerifyRow {
  id: string;
  file_name: string;
  completed_steps: number;
  total_steps: number;
  certified: boolean;
  created_at: string;
  snapshot: SnapshotPayload | null;
  tenant_name: string | null;
}

type VerificationStatus = "valid" | "missing" | "expired";

function getVerificationStatus(row: VerifyRow | null): {
  status: VerificationStatus;
  label: string;
  daysOld: number | null;
} {
  if (!row) {
    return { status: "missing", label: "Missing", daysOld: null };
  }
  const daysOld = differenceInDays(new Date(), new Date(row.created_at));
  const EXPIRY_DAYS = 90;
  if (daysOld > EXPIRY_DAYS) {
    return { status: "expired", label: "Expired", daysOld };
  }
  return { status: "valid", label: "Valid", daysOld };
}

function VerificationStatusBadge({ row }: { row: VerifyRow | null }) {
  const { status, label, daysOld } = getVerificationStatus(row);
  const icon =
    status === "valid" ? (
      <ShieldCheck className="h-3.5 w-3.5" />
    ) : status === "expired" ? (
      <Clock className="h-3.5 w-3.5" />
    ) : (
      <ShieldAlert className="h-3.5 w-3.5" />
    );

  const className =
    status === "valid"
      ? "bg-emerald-600 hover:bg-emerald-600 text-white"
      : status === "expired"
      ? "bg-rose-600 hover:bg-rose-600 text-white"
      : "bg-destructive hover:bg-destructive text-white";

  return (
    <Badge className={`gap-1 ${className}`}>
      {icon}
      {label}
      {daysOld !== null && status === "expired" && (
        <span className="opacity-80">({daysOld}d)</span>
      )}
    </Badge>
  );
}

export default function VerifyZatcaReport() {
  const { token } = useParams<{ token: string }>();
  const [row, setRow] = useState<VerifyRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setError("Missing verification token.");
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.rpc(
        "get_zatca_certification_snapshot",
        { _token: token },
      );
      if (cancelled) return;
      if (error) {
        setError(error.message);
      } else if (!data || (Array.isArray(data) && data.length === 0)) {
        setError("No report found for this verification link.");
      } else {
        const r = Array.isArray(data) ? data[0] : data;
        setRow(r as unknown as VerifyRow);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
              Home
            </Link>
          </Button>
          <p className="text-xs text-muted-foreground">ZATCA Phase 2 verification</p>
        </div>

        {loading ? (
          <Card>
            <CardContent className="py-10 flex items-center justify-center text-sm text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Verifying report…
            </CardContent>
          </Card>
        ) : error || !row ? (
          <Card className="border-destructive/40">
            <CardHeader>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldAlert className="h-5 w-5 text-destructive" />
                    Verification failed
                  </CardTitle>
                  <CardDescription>{error ?? "Unknown error"}</CardDescription>
                </div>
                <VerificationStatusBadge row={null} />
              </div>
            </CardHeader>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-5 w-5 text-emerald-600" />
                    Verified certification snapshot
                  </CardTitle>
                  <CardDescription>
                    {row.tenant_name ?? row.snapshot?.tenantName ?? "Restaurant"} ·{" "}
                    {format(new Date(row.created_at), "PPpp")}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <VerificationStatusBadge row={row} />
                  <Badge
                    className={
                      row.certified
                        ? "bg-emerald-600 hover:bg-emerald-600"
                        : "bg-amber-500 hover:bg-amber-500"
                    }
                  >
                    {row.certified
                      ? "Certified"
                      : `${row.completed_steps}/${row.total_steps} steps`}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 text-sm">
              {row.snapshot?.seller && (
                <section>
                  <h2 className="font-medium mb-2">Seller identity</h2>
                  <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Name (EN)</dt>
                    <dd>{row.snapshot.seller.name_en || "-"}</dd>
                    <dt className="text-muted-foreground">Name (AR)</dt>
                    <dd>{row.snapshot.seller.name_ar || "-"}</dd>
                    <dt className="text-muted-foreground">VAT number</dt>
                    <dd className="font-mono">
                      {row.snapshot.seller.vat_registration_number || "-"}
                    </dd>
                    <dt className="text-muted-foreground">Phase mode</dt>
                    <dd>{row.snapshot.seller.zatca_phase_mode || "-"}</dd>
                  </dl>
                </section>
              )}

              {row.snapshot?.steps && row.snapshot.steps.length > 0 && (
                <section>
                  <h2 className="font-medium mb-2">Checklist</h2>
                  <ul className="space-y-1.5">
                    {row.snapshot.steps.map((s, i) => {
                      const Icon = s.state === "done" ? CheckCircle2 : Circle;
                      const tone =
                        s.state === "done"
                          ? "text-emerald-600"
                          : s.state === "pending"
                          ? "text-amber-600"
                          : "text-muted-foreground";
                      return (
                        <li key={s.id} className="flex items-center gap-2 text-xs">
                          <Icon className={`h-4 w-4 ${tone}`} />
                          <span className="text-muted-foreground">{i + 1}.</span>
                          <span>{s.title}</span>
                          <span className="ml-auto uppercase tracking-wide text-[10px] text-muted-foreground">
                            {s.state}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {row.snapshot?.devices && row.snapshot.devices.length > 0 && (
                <section>
                  <h2 className="font-medium mb-2">Registered devices</h2>
                  <ul className="space-y-2">
                    {row.snapshot.devices.map((d) => (
                      <li key={d.serial_number} className="rounded-md border p-2 text-xs">
                        <p className="font-medium">
                          {d.name}{" "}
                          <span className="font-mono text-muted-foreground">
                            SN {d.serial_number}
                          </span>
                        </p>
                        <p className="text-muted-foreground">
                          Status: {d.registration_status} · ICV {d.icv_counter}
                        </p>
                        <p className="text-muted-foreground">
                          Compliance CSID:{" "}
                          {d.compliance_csid_issued ? "issued" : "-"} · Production CSID:{" "}
                          {d.production_csid_issued ? "issued" : "-"}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {row.snapshot?.metrics && (
                <section>
                  <h2 className="font-medium mb-2">Clearance health (last 30 days)</h2>
                  <p className="text-xs text-muted-foreground">
                    {(row.snapshot.metrics.successRate * 100).toFixed(1)}% success ·{" "}
                    {row.snapshot.metrics.cleared} cleared · {row.snapshot.metrics.rejected} rejected ·{" "}
                    {row.snapshot.metrics.total} total
                  </p>
                </section>
              )}

              <p className="text-[11px] text-muted-foreground pt-2 border-t">
                This snapshot is served directly from the authoritative audit trail. The QR code
                in the PDF resolves to this URL - anyone can independently verify the report.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}