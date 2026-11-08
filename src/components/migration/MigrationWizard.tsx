import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  Loader2,
  Plug,
  Rocket,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  ENTITY_SPECS,
  EntityType,
  RowOutcome,
  buildTemplateCsv,
  downloadCsv,
  normalizeAndValidate,
  readCsv,
} from "@/lib/migration/parsers";

type Step = "source" | "upload" | "review" | "live";

const SOURCES: { value: string; label: string; comingSoon?: boolean }[] = [
  { value: "csv", label: "CSV / Excel upload" },
  { value: "foodics", label: "Foodics (direct connect)", comingSoon: true },
  { value: "micros", label: "Oracle Micros (direct connect)", comingSoon: true },
  { value: "square", label: "Square (direct connect)", comingSoon: true },
  { value: "other", label: "Other / custom export" },
];

const ENTITIES: EntityType[] = ["menu", "inventory", "customers", "staff"];

export function MigrationWizard() {
  const { restaurant, user } = useAuth();
  const [step, setStep] = useState<Step>("source");
  const [source, setSource] = useState<string>("csv");
  const [entity, setEntity] = useState<EntityType>("menu");
  const [parsed, setParsed] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<RowOutcome[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string>("");

  const spec = ENTITY_SPECS[entity];

  // Re-validate when mapping changes
  useEffect(() => {
    if (parsed) setOutcomes(normalizeAndValidate(parsed.rows, mapping, spec));
  }, [parsed, mapping, spec]);

  const stats = useMemo(() => {
    const total = outcomes.length;
    const valid = outcomes.filter(o => o.status === "valid").length;
    return { total, valid, invalid: total - valid };
  }, [outcomes]);

  async function handleFile(file: File) {
    if (!restaurant?.id) return toast.error("No restaurant selected");
    setBusy(true);
    try {
      const text = await file.text();
      const result = readCsv(text, spec);
      if (result.rows.length === 0) {
        toast.error("No rows found in the file");
        return;
      }
      setParsed({ headers: result.headers, rows: result.rows });
      setMapping(result.suggestedMapping);
      setFileName(file.name);

      // Upload to storage
      const path = `${restaurant.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("migration-uploads").upload(path, file, { upsert: true });
      if (upErr) console.warn("Upload warning:", upErr.message);

      // Create job
      const { data: job, error: jobErr } = await supabase
        .from("migration_jobs")
        .insert({
          restaurant_id: restaurant.id,
          source_system: source,
          entity_type: entity,
          status: "draft",
          file_path: path,
          file_name: file.name,
          total_count: result.rows.length,
          created_by: user?.id,
        })
        .select("id")
        .single();
      if (jobErr) throw jobErr;
      setJobId(job.id);
      setStep("review");
      toast.success(`Parsed ${result.rows.length} rows`);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message ?? "Failed to read file");
    } finally {
      setBusy(false);
    }
  }

  async function goLive() {
    if (!jobId || !restaurant?.id) return;
    if (stats.valid === 0) return toast.error("No valid rows to import");
    setBusy(true);
    try {
      // Persist staged records (cap to first 1000 valid rows to keep payload small)
      const validOutcomes = outcomes.filter(o => o.status === "valid").slice(0, 1000);
      const records = validOutcomes.map(o => ({
        job_id: jobId,
        restaurant_id: restaurant.id,
        row_number: o.rowNumber,
        raw: o.raw as any,
        normalized: o.normalized as any,
        errors: o.errors as any,
        status: "valid",
      }));
      // chunk inserts
      for (let i = 0; i < records.length; i += 200) {
        const chunk = records.slice(i, i + 200);
        const { error } = await supabase.from("migration_records").insert(chunk);
        if (error) throw error;
      }
      await supabase
        .from("migration_jobs")
        .update({
          status: "ready",
          mapping,
          total_count: outcomes.length,
          error_count: stats.invalid,
          summary: { valid: stats.valid, invalid: stats.invalid, total: stats.total },
        })
        .eq("id", jobId);

      const { data, error } = await supabase.functions.invoke("migration-commit", {
        body: { job_id: jobId },
      });
      if (error) throw error;
      toast.success(`Imported ${data?.imported ?? stats.valid} ${spec.label.toLowerCase()}`);
      setStep("live");
    } catch (e: any) {
      console.error(e);
      toast.error(e.message ?? "Failed to go live");
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setStep("source");
    setParsed(null);
    setMapping({});
    setOutcomes([]);
    setJobId(null);
    setFileName("");
  }

  return (
    <div className="space-y-6">
      {/* Marketing intro */}
      {step === "source" && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          <Card className="p-6 md:p-8 bg-gradient-to-br from-primary/5 to-transparent border-primary/20">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Rocket className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg md:text-xl font-semibold tracking-tight">Move to Matbex without losing momentum</h2>
                <p className="text-sm text-muted-foreground max-w-2xl">
                  Switching POS systems shouldn't slow your business down. Upload your data, validate it
                  safely in a sandbox, and go live when you're ready. No surprises, no lost data.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 mt-6">
              <Feature icon={<ShieldCheck className="h-4 w-4" />} title="Safe" desc="Sandbox preview before any data is written." />
              <Feature icon={<CheckCircle2 className="h-4 w-4" />} title="Validated" desc="Issues caught automatically before go-live." />
              <Feature icon={<Database className="h-4 w-4" />} title="Yours" desc="You stay in control at every step." />
            </div>
          </Card>
        </motion.div>
      )}

      {/* Stepper */}
      <Stepper step={step} />

      {/* Source */}
      {step === "source" && (
        <Card className="p-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold mb-1">Where are you coming from?</h3>
            <p className="text-xs text-muted-foreground">Pick your previous system. Direct connectors are rolling out; CSV/Excel works for any POS.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {SOURCES.map(s => (
              <button
                key={s.value}
                onClick={() => !s.comingSoon && setSource(s.value)}
                disabled={s.comingSoon}
                className={`text-left rounded-lg border p-3 transition ${
                  source === s.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                } ${s.comingSoon ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Plug className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{s.label}</span>
                  </div>
                  {s.comingSoon && <Badge variant="secondary" className="text-[10px]">Coming soon</Badge>}
                </div>
              </button>
            ))}
          </div>
          <div className="pt-2 border-t">
            <p className="text-xs font-medium mb-2">What would you like to import first?</p>
            <Tabs value={entity} onValueChange={(v) => setEntity(v as EntityType)}>
              <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
                {ENTITIES.map(e => (
                  <TabsTrigger key={e} value={e} className="text-xs">{ENTITY_SPECS[e].label}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <p className="text-xs text-muted-foreground mt-2">{spec.description}</p>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => setStep("upload")} className="gap-2">
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      )}

      {/* Upload */}
      {step === "upload" && (
        <Card className="p-5 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold">Upload your {spec.label.toLowerCase()}</h3>
              <p className="text-xs text-muted-foreground mt-1">CSV files only. Headers in the first row.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadCsv(`matbex-${spec.type}-template.csv`, buildTemplateCsv(spec))}
              className="gap-2"
            >
              <Download className="h-4 w-4" /> Template
            </Button>
          </div>

          <label
            htmlFor="migration-file"
            className="border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition"
          >
            {busy ? (
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
            ) : (
              <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
            )}
            <div className="text-center">
              <p className="text-sm font-medium">Drop your CSV here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">We'll validate every row before anything is written.</p>
            </div>
            <input
              id="migration-file"
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep("source")}>Back</Button>
          </div>
        </Card>
      )}

      {/* Review */}
      {step === "review" && parsed && (
        <Card className="p-5 space-y-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold">Sandbox preview</h3>
              <p className="text-xs text-muted-foreground mt-1">{fileName} · {parsed.rows.length} rows</p>
            </div>
            <div className="flex gap-2">
              <Badge variant="default" className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15">
                {stats.valid} valid
              </Badge>
              {stats.invalid > 0 && (
                <Badge variant="destructive" className="bg-destructive/15 text-destructive hover:bg-destructive/15">
                  {stats.invalid} with issues
                </Badge>
              )}
            </div>
          </div>

          {/* Mapping */}
          <div>
            <p className="text-xs font-medium mb-2">Map your columns</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {spec.fields.map(f => (
                <div key={f.key} className="flex items-center gap-2 text-xs">
                  <span className="w-32 shrink-0 text-muted-foreground">
                    {f.label}{f.required && <span className="text-destructive ml-0.5">*</span>}
                  </span>
                  <Select
                    value={mapping[f.key] ?? "__none__"}
                    onValueChange={(v) => setMapping(m => ({ ...m, [f.key]: v === "__none__" ? "" : v }))}
                  >
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue placeholder="-" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">- Skip -</SelectItem>
                      {parsed.headers.map(h => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div>
            <p className="text-xs font-medium mb-2">First 50 rows</p>
            <ScrollArea className="max-h-[360px] border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left p-2 font-medium w-8">#</th>
                    <th className="text-left p-2 font-medium w-8"></th>
                    {spec.fields.map(f => (
                      <th key={f.key} className="text-left p-2 font-medium">{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {outcomes.slice(0, 50).map(o => (
                    <tr key={o.rowNumber} className="border-t">
                      <td className="p-2 text-muted-foreground">{o.rowNumber}</td>
                      <td className="p-2">
                        {o.status === "valid"
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                      </td>
                      {spec.fields.map(f => (
                        <td key={f.key} className={`p-2 ${o.errors.some(e => e.includes(f.label)) ? "text-destructive" : ""}`}>
                          {String(o.normalized?.[f.key] ?? (mapping[f.key] ? o.raw[mapping[f.key]] : "")) || <span className="text-muted-foreground/50">-</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
            {stats.invalid > 0 && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Show {stats.invalid} issues
                </summary>
                <ul className="mt-2 space-y-1 max-h-40 overflow-auto">
                  {outcomes.filter(o => o.status === "invalid").slice(0, 100).map(o => (
                    <li key={o.rowNumber} className="text-destructive">
                      Row {o.rowNumber}: {o.errors.join("; ")}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={restart}>Start over</Button>
            <Button onClick={goLive} disabled={busy || stats.valid === 0} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Go live with {stats.valid} {spec.label.toLowerCase()}
            </Button>
          </div>
        </Card>
      )}

      {/* Live */}
      {step === "live" && (
        <Card className="p-8 text-center space-y-4">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.25 }}>
            <div className="h-14 w-14 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            </div>
          </motion.div>
          <div>
            <h3 className="text-base font-semibold">You're live on Matbex</h3>
            <p className="text-sm text-muted-foreground mt-1">Your {spec.label.toLowerCase()} have been imported. Migrate another set whenever you're ready.</p>
          </div>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={restart}>Import more</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 mb-1">
        <div className="h-6 w-6 rounded-md bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
        <p className="text-sm font-medium">{title}</p>
      </div>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: { key: Step; label: string; icon: React.ReactNode }[] = [
    { key: "source", label: "Source", icon: <Plug className="h-3.5 w-3.5" /> },
    { key: "upload", label: "Upload", icon: <Upload className="h-3.5 w-3.5" /> },
    { key: "review", label: "Review", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
    { key: "live", label: "Go live", icon: <Rocket className="h-3.5 w-3.5" /> },
  ];
  const idx = steps.findIndex(s => s.key === step);
  return (
    <div className="flex items-center gap-1 text-xs">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1">
          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md ${
            i <= idx ? "bg-primary/10 text-primary" : "text-muted-foreground"
          }`}>
            {s.icon}
            <span className="font-medium">{s.label}</span>
          </div>
          {i < steps.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground/40" />}
        </div>
      ))}
    </div>
  );
}