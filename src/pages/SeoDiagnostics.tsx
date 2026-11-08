import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  runSeoDiagnostics,
  reportToCsv,
  summarise,
  type CheckStatus,
  type SeoDiagnosticsReport,
} from "@/lib/seoDiagnostics";
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Search, XCircle } from "lucide-react";

const STATUS_META: Record<CheckStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  pass: { label: "Pass", icon: CheckCircle2, className: "text-primary" },
  warn: { label: "Warning", icon: AlertTriangle, className: "text-muted-foreground" },
  fail: { label: "Fail", icon: XCircle, className: "text-destructive" },
};

function StatusBadge({ status }: { status: CheckStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge variant={status === "fail" ? "destructive" : status === "warn" ? "secondary" : "outline"} className="gap-1">
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

export default function SeoDiagnostics() {
  const [report, setReport] = useState<SeoDiagnosticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await runSeoDiagnostics());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  const summary = useMemo(() => (report ? summarise(report.checks) : null), [report]);

  const downloadCsv = () => {
    if (!report) return;
    const blob = new Blob([reportToCsv(report)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `seo-diagnostics-${report.scannedAt.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            SEO Diagnostics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live inspection of the head tags, favicons, manifest and crawl files served from{" "}
            <span className="font-mono">{report?.origin ?? window.location.origin}</span>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!report}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
          <Button size="sm" onClick={() => void scan()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Re-scan
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {(["pass", "warn", "fail"] as CheckStatus[]).map((s) => (
          <Card key={s}>
            <CardHeader className="pb-3">
              <CardDescription>{STATUS_META[s].label}</CardDescription>
              <CardTitle className={`text-3xl font-light ${STATUS_META[s].className}`}>
                {loading || !summary ? <Skeleton className="h-8 w-12" /> : summary[s]}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="checks">
        <TabsList>
          <TabsTrigger value="checks">Checks</TabsTrigger>
          <TabsTrigger value="head">Head tags</TabsTrigger>
          <TabsTrigger value="icons">Icons &amp; manifest</TabsTrigger>
          <TabsTrigger value="crawl">Crawl files</TabsTrigger>
        </TabsList>

        <TabsContent value="checks" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">What Google should fetch</CardTitle>
              <CardDescription>
                {report ? `Scanned ${new Date(report.scannedAt).toLocaleString()}` : "Scanning…"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading && !report
                ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
                : report?.checks.map((c) => (
                    <div key={c.id} className="flex flex-col gap-1 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="text-sm font-medium">{c.label}</div>
                        {c.value && <div className="font-mono text-xs text-muted-foreground break-all">{c.value}</div>}
                        <div className="text-xs text-muted-foreground">{c.detail}</div>
                      </div>
                      <StatusBadge status={c.status} />
                    </div>
                  ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="head" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Rendered document head</CardTitle>
              <CardDescription>Exactly what a JavaScript-executing crawler sees on this route.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[520px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Type</TableHead>
                      <TableHead className="w-52">Name</TableHead>
                      <TableHead>Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report?.headTags.map((t, i) => (
                      <TableRow key={`${t.key}-${i}`}>
                        <TableCell className="text-xs text-muted-foreground">{t.kind}</TableCell>
                        <TableCell className="font-mono text-xs break-all">{t.key}</TableCell>
                        <TableCell className="font-mono text-xs break-all">{t.value}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="icons" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Favicon probes</CardTitle>
              <CardDescription>Each declared icon is fetched from this origin to confirm it really exists.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>URL</TableHead>
                    <TableHead className="w-20">HTTP</TableHead>
                    <TableHead className="w-40">Type</TableHead>
                    <TableHead className="w-24">Bytes</TableHead>
                    <TableHead className="w-24">Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report?.iconProbes.map((p) => (
                    <TableRow key={p.url}>
                      <TableCell className="font-mono text-xs break-all">{p.url.replace(report.origin, "")}</TableCell>
                      <TableCell className="text-xs">{p.httpStatus ?? "—"}</TableCell>
                      <TableCell className="text-xs">{p.contentType ?? "—"}</TableCell>
                      <TableCell className="text-xs">{p.bytes ?? "—"}</TableCell>
                      <TableCell><StatusBadge status={p.ok ? "pass" : "fail"} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Web app manifest</CardTitle>
              <CardDescription className="font-mono break-all">{report?.manifest.href ?? "Not declared"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {report?.manifest.parseError && (
                <p className="text-sm text-destructive">Invalid JSON: {report.manifest.parseError}</p>
              )}
              {report?.manifest.icons.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>src</TableHead>
                      <TableHead className="w-28">sizes</TableHead>
                      <TableHead className="w-32">type</TableHead>
                      <TableHead className="w-28">purpose</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.manifest.icons.map((i) => (
                      <TableRow key={`${i.src}-${i.sizes ?? ""}`}>
                        <TableCell className="font-mono text-xs break-all">{i.src}</TableCell>
                        <TableCell className="text-xs">{i.sizes ?? "—"}</TableCell>
                        <TableCell className="text-xs">{i.type ?? "—"}</TableCell>
                        <TableCell className="text-xs">{i.purpose ?? "any"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No icons declared in the manifest.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="crawl" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">robots.txt</CardTitle>
              <CardDescription>
                HTTP {report?.robots.httpStatus ?? "—"}
                {report?.robots.disallowsAll ? " · site-wide Disallow detected" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-64 rounded-md border bg-muted/30 p-3">
                <pre className="font-mono text-xs whitespace-pre-wrap">{report?.robots.body ?? "—"}</pre>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">sitemap.xml</CardTitle>
              <CardDescription>
                HTTP {report?.sitemap.httpStatus ?? "—"} · {report?.sitemap.urlCount ?? 0} URL(s)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-64 rounded-md border bg-muted/30 p-3">
                <pre className="font-mono text-xs whitespace-pre-wrap">{report?.sitemap.body?.slice(0, 4000) ?? "—"}</pre>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        Note: this reflects the origin you are currently browsing. Run it on the published domain for the exact bytes
        Google fetches — and remember Google caches favicons for weeks after they change.
      </p>
    </div>
  );
}
