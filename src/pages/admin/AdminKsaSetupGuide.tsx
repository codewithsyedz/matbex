import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  MapPin,
  Server,
  ShieldCheck,
  Terminal,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="h-7 gap-1 text-xs"
    >
      {copied ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {label || (copied ? "Copied" : "Copy")}
    </Button>
  );
}

function StepCard({
  number,
  title,
  icon: Icon,
  children,
}: {
  number: number;
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-medium text-muted-foreground">
              Step {number}
            </span>
            <CardTitle className="text-base font-semibold">{title}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  return (
    <div className="relative mt-2 rounded-lg bg-muted/60 border border-border/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted border-b border-border/40">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {language}
        </span>
        <CopyButton text={code} />
      </div>
      <pre className="px-3 py-2.5 text-xs font-mono text-foreground/90 overflow-x-auto">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function AdminKsaSetupGuide() {
  const navigate = useNavigate();

  const envSnippet = `VITE_API_URL_KSA=https://api.sa.matbex.com
VITE_API_KEY_KSA=<ksa-deployment-anon-key>`;

  const schemaCheckSql = `SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'tenants'
  AND column_name IN ('data_region', 'residency_locked');`;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            size="sm"
            className="mb-4 -ml-2 gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/admin")}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Admin
          </Button>

          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                KSA Data Residency Setup
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Provision a Saudi-region project and wire it into the platform.
              </p>
            </div>
          </div>
        </div>

        {/* Alert */}
        <Alert className="mb-6 border-amber-500/20 bg-amber-500/5">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-sm font-medium text-amber-700">
            SuperAdmin only
          </AlertTitle>
          <AlertDescription className="text-xs text-amber-600/80">
            This guide is for platform operators. Region changes are guarded by
            triggers and written to audit logs.
          </AlertDescription>
        </Alert>

        <div className="space-y-5">
          <StepCard number={1} title="Provision the KSA deployment" icon={Server}>
            <ol className="space-y-3 text-sm text-muted-foreground list-decimal list-inside">
              <li>
                Create a PostgreSQL 16 instance and a VM/container host in a Saudi region (e.g.{" "}
                <Badge variant="secondary" className="text-[10px] font-mono">
                  me-central2
                </Badge>{" "}
                Riyadh, or an in-Kingdom provider).
              </li>
              <li>
                Deploy the Matbex stack there with{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">docker compose up -d</code>{" "}
                (API, PostgREST, object storage) using its own <code className="text-xs font-mono">.env</code>.
              </li>
              <li>Point a hostname such as <code className="text-xs font-mono">api.sa.matbex.com</code> at it.</li>
            </ol>
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/50 p-3">
              <MapPin className="h-4 w-4 text-emerald-600" />
              <span className="text-xs text-muted-foreground">
                Database, object storage and backups must all stay in-Kingdom for full KSA data-residency compliance.
              </span>
            </div>
          </StepCard>

          <StepCard number={2} title="Apply the same schema" icon={Terminal}>
            <p className="text-sm text-muted-foreground">
              The KSA database uses the exact same migrations as the global one. Run the migration runner against it:
            </p>
            <CodeBlock
              language="bash"
              code={`DATABASE_URL="postgresql://user:pass@ksa-db:5432/matbex" \\
AUTHENTICATOR_PASSWORD=... npm run db:migrate`}
            />
          </StepCard>

          <StepCard number={3} title="Collect KSA deployment credentials" icon={KeyRound}>
            <ol className="space-y-3 text-sm text-muted-foreground list-decimal list-inside">
              <li>
                Generate keys for the KSA deployment with{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">npm --prefix server run keys</code>.
              </li>
              <li>
                Note the public <strong className="text-foreground">API URL</strong> and the{" "}
                <strong className="text-foreground">ANON_KEY</strong>.
              </li>
            </ol>
            <div className="mt-3 rounded-lg border border-border/40 p-3">
              <p className="text-xs text-muted-foreground mb-1.5">
                You will need these two values:
              </p>
              <div className="space-y-1.5 font-mono text-xs">
                <div className="flex items-center justify-between rounded bg-muted px-2 py-1">
                  <span className="text-muted-foreground">URL</span>
                  <span className="text-foreground">https://api.sa.matbex.com</span>
                </div>
                <div className="flex items-center justify-between rounded bg-muted px-2 py-1">
                  <span className="text-muted-foreground">anon key</span>
                  <span className="text-foreground">eyJhbGciOiJIUzI1NiIs...</span>
                </div>
              </div>
            </div>
          </StepCard>

          <StepCard number={4} title="Set frontend environment variables" icon={Terminal}>
            <p className="text-sm text-muted-foreground">
              Add the KSA credentials to the environment where the frontend is
              built. The app reads them at runtime to route KSA tenants to the
              correct endpoint.
            </p>
            <CodeBlock code={envSnippet} />
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-muted/50 p-3">
              <ShieldCheck className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  <strong className="text-foreground">Deployment tip:</strong>{" "}
                  These are build-time variables. Add them in your deployment
                  dashboard (e.g., Vercel → Project Settings → Environment
                  Variables), then redeploy.
                </p>
                <p>
                  The frontend gracefully falls back to the global client when
                  these variables are missing, so existing tenants are never
                  broken.
                </p>
              </div>
            </div>
          </StepCard>

          <StepCard number={5} title="Verify the schema on KSA" icon={CheckCircle2}>
            <p className="text-sm text-muted-foreground">
              Make sure the KSA project has the residency columns so the trigger
              guard can work:
            </p>
            <CodeBlock code={schemaCheckSql} language="sql" />
            <p className="mt-3 text-sm text-muted-foreground">
              You should see two rows:{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
                data_region
              </code>{" "}
              and{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
                residency_locked
              </code>
              . If they are missing, re-run the migration that added them.
            </p>
          </StepCard>

          <StepCard number={6} title="Assign a tenant to KSA" icon={Globe}>
            <p className="text-sm text-muted-foreground">
              Once the project is wired in, go to any tenant&apos;s detail page,
              open the{" "}
              <strong className="text-foreground">Residency</strong> tab, set
              Region to <strong className="text-foreground">KSA</strong>, save,
              and optionally enable{" "}
              <strong className="text-foreground">Residency Locked</strong> to
              prevent accidental moves.
            </p>
            <div className="mt-3 rounded-lg border border-border/40 p-3">
              <p className="text-xs text-muted-foreground">
                After flipping the region, the tenant&apos;s next login will use
                the KSA endpoint. You can verify by checking the{" "}
                <span
                  className="inline-flex items-center gap-1 cursor-pointer text-emerald-600 hover:underline"
                  onClick={() => navigate("/admin/residency-audit")}
                >
                  Residency Audit
                  <ExternalLink className="h-3 w-3" />
                </span>{" "}
                log.
              </p>
            </div>
          </StepCard>
        </div>

        <Separator className="my-8" />

        {/* Footer actions */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/admin/residency-audit")}
          >
            <ShieldCheck className="h-4 w-4 mr-1.5" />
            View Residency Audit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/admin/tenants")}
          >
            <Building2 className="h-4 w-4 mr-1.5" />
            Go to Tenants
          </Button>
        </div>
      </div>
    </div>
  );
}
