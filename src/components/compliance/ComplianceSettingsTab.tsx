import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Sparkles } from "lucide-react";
import { useComplianceConfig } from "@/hooks/useComplianceConfig";

export function ComplianceSettingsTab({ canManage }: { canManage: boolean }) {
  const {
    settings,
    categories,
    types,
    escalationRules,
    isSeeded,
    seedDefaults,
    saveSettings,
    saveType,
    saveEscalationRule,
  } = useComplianceConfig();

  const [draft, setDraft] = useState<Record<string, number> | null>(null);
  const value = (key: string, fallback: number) =>
    draft?.[key] ?? (settings as unknown as Record<string, number> | null)?.[key] ?? fallback;
  const patch = (key: string, v: number) => setDraft((d) => ({ ...(d ?? {}), [key]: v }));

  return (
    <div className="space-y-4">
      {!isSeeded ? (
        <Alert>
          <Sparkles className="h-4 w-4" />
          <AlertTitle>Set up compliance defaults</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span className="text-xs">
              Seeds Balady-aligned categories (cleanliness, food safety, hygiene, employee practices,
              SOP), common violation types, escalation rules and opening/closing checklists.
            </span>
            <Button
              size="sm"
              className="w-fit"
              disabled={!canManage || seedDefaults.isPending}
              onClick={() => seedDefaults.mutate()}
            >
              {seedDefaults.isPending ? "Seeding…" : "Seed default configuration"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Scoring &amp; repeat detection</CardTitle>
          <CardDescription>Weights must reflect how you want the branch score composed.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Num label="Repeat lookback (days)" v={value("repeat_lookback_days", 90)} onChange={(n) => patch("repeat_lookback_days", n)} />
          <Num label="Default correction days" v={value("default_correction_days", 3)} onChange={(n) => patch("default_correction_days", n)} />
          <Num label="Weight — cleanliness" v={value("weight_cleanliness", 25)} onChange={(n) => patch("weight_cleanliness", n)} />
          <Num label="Weight — food safety" v={value("weight_food_safety", 35)} onChange={(n) => patch("weight_food_safety", n)} />
          <Num label="Weight — employee SOP" v={value("weight_employee_sop", 20)} onChange={(n) => patch("weight_employee_sop", n)} />
          <Num label="Weight — checklists" v={value("weight_checklists", 20)} onChange={(n) => patch("weight_checklists", n)} />
          <div className="md:col-span-3">
            <Button
              size="sm"
              disabled={!canManage || !draft || saveSettings.isPending}
              onClick={() => {
                saveSettings.mutate(draft ?? {});
                setDraft(null);
              }}
            >
              Save settings
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Violation types</CardTitle>
          <CardDescription>{categories.length} categories · {types.length} types</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead className="text-right">Correction days</TableHead>
                <TableHead className="text-right">Evidence</TableHead>
                <TableHead className="text-right">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{categories.find((c) => c.id === t.category_id)?.name_en ?? "—"}</TableCell>
                  <TableCell className="font-medium">{t.name_en}</TableCell>
                  <TableCell><Badge variant="outline">{t.severity}</Badge></TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      className="ml-auto h-8 w-20 text-right"
                      defaultValue={t.default_correction_days}
                      disabled={!canManage}
                      onBlur={(e) =>
                        saveType.mutate({ ...t, default_correction_days: Number(e.target.value) })
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={t.requires_evidence}
                      disabled={!canManage}
                      onCheckedChange={(v) => saveType.mutate({ ...t, requires_evidence: v })}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={t.is_active}
                      disabled={!canManage}
                      onCheckedChange={(v) => saveType.mutate({ ...t, is_active: v })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Repeat escalation rules</CardTitle>
          <CardDescription>
            Recommended management action when the same violation type recurs at a branch.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Occurrence</TableHead>
                <TableHead>Recommended action</TableHead>
                <TableHead className="text-right">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {escalationRules.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">No escalation rules configured.</TableCell></TableRow>
              ) : (
                escalationRules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>#{r.occurrence_count}</TableCell>
                    <TableCell>
                      <Input
                        className="h-8"
                        defaultValue={r.action_label}
                        disabled={!canManage}
                        onBlur={(e) => saveEscalationRule.mutate({ ...r, action_label: e.target.value })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={r.is_active}
                        disabled={!canManage}
                        onCheckedChange={(v) => saveEscalationRule.mutate({ ...r, is_active: v })}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Num({ label, v, onChange }: { label: string; v: number; onChange: (n: number) => void }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={v} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}