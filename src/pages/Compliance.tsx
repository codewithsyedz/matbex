import { useMemo, useState } from "react";
import { format, startOfMonth } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BranchScopeSelector } from "@/components/branches/BranchScopeSelector";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { exportToCSV } from "@/lib/exportUtils";

import {
  COMPLIANCE_SOURCE_LABELS,
  COMPLIANCE_STATUS_LABELS,
  useComplianceViolations,
  type ComplianceStatus,
  type ComplianceViolation,
  type ViolationFilters,
} from "@/hooks/useComplianceViolations";
import { useComplianceConfig } from "@/hooks/useComplianceConfig";
import { useMunicipalityFines, type MunicipalityFine } from "@/hooks/useMunicipalityFines";
import { useComplianceDashboard, useEmployeeSopSummary } from "@/hooks/useComplianceDashboard";

import { ComplianceOverviewTab } from "@/components/compliance/ComplianceOverviewTab";
import { ComplianceAlertsTab } from "@/components/compliance/ComplianceAlertsTab";
import { useComplianceAlerts } from "@/hooks/useComplianceAlerts";
import { Badge } from "@/components/ui/badge";
import { ViolationsTab } from "@/components/compliance/ViolationsTab";
import { ViolationDialog } from "@/components/compliance/ViolationDialog";
import { ViolationDetailSheet } from "@/components/compliance/ViolationDetailSheet";
import { MunicipalityFinesTab } from "@/components/compliance/MunicipalityFinesTab";
import { ChecklistsTab } from "@/components/compliance/ChecklistsTab";
import { ComplianceSettingsTab } from "@/components/compliance/ComplianceSettingsTab";

export default function Compliance() {
  const { restaurant } = useAuth();
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { isOwner, isManager } = usePermissions();
  const scopedBranchId = pinnedBranchId ?? activeBranchId ?? null;

  const [tab, setTab] = useState("overview");
  const [filters, setFilters] = useState<ViolationFilters>({
    from: format(startOfMonth(new Date()), "yyyy-MM-dd"),
    to: format(new Date(), "yyyy-MM-dd"),
    status: "open",
  });
  const patchFilters = (p: Partial<ViolationFilters>) => setFilters((f) => ({ ...f, ...p }));

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ComplianceViolation | null>(null);
  const [selected, setSelected] = useState<ComplianceViolation | null>(null);
  const [finePrefill, setFinePrefill] = useState<Partial<MunicipalityFine> | null>(null);

  const { categories } = useComplianceConfig();
  const { violations, isLoading, saveViolation, changeStatus } = useComplianceViolations(filters);
  const fines = useMunicipalityFines({ from: filters.from, to: filters.to });
  const { data: scores = [], isLoading: scoresLoading } = useComplianceDashboard(
    filters.from ?? "",
    filters.to ?? "",
  );
  const { data: employees = [] } = useEmployeeSopSummary(filters.from ?? "", filters.to ?? "");
  const { unacknowledged } = useComplianceAlerts();

  const { data: staff = [] } = useQuery({
    queryKey: ["compliance-staff", restaurant?.id, scopedBranchId],
    queryFn: async () => {
      let q = supabase
        .from("staff")
        .select("id, name")
        .eq("restaurant_id", restaurant!.id)
        .eq("is_active", true)
        .order("name");
      if (scopedBranchId) q = q.eq("branch_id", scopedBranchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
    enabled: !!restaurant?.id,
  });

  const branchName = useMemo(
    () => branches.find((b) => b.id === scopedBranchId)?.name ?? "All branches",
    [branches, scopedBranchId],
  );

  const exportViolations = () => {
    exportToCSV({
      filename: `compliance-violations-${branchName}-${filters.from}-${filters.to}`,
      headers: [
        "Reference", "Date", "Branch", "Category", "Type", "Source",
        "Responsible", "Status", "Overdue", "Due date", "Municipality fine", "Amount",
      ],
      rows: violations.map((v) => [
        v.violation_number ?? "",
        v.violation_date,
        v.branch?.name ?? "",
        v.category?.name_en ?? "",
        v.violation_type?.name_en ?? "",
        COMPLIANCE_SOURCE_LABELS[v.source],
        v.responsible_staff?.name ?? "",
        COMPLIANCE_STATUS_LABELS[v.status],
        v.is_overdue ? "Yes" : "No",
        v.corrective_action_due_date ?? "",
        v.is_municipality_fine ? "Yes" : "No",
        Number(v.fine_amount || 0),
      ]),
    });
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between min-h-[56px]">
          <div className="space-y-1 min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Balady &amp; compliance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Municipality inspections, hygiene and SOP violations, corrective actions and daily checks —
            tracked per branch with a full audit trail.
          </p>
        </div>
        <BranchScopeSelector hint="Every compliance figure on this page follows this branch" />
      </header>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="overview">Dashboard</TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2">
            Alerts
            {unacknowledged.length > 0 && (
              <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                {unacknowledged.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="violations">Violations</TabsTrigger>
          <TabsTrigger value="fines">Municipality fines</TabsTrigger>
          <TabsTrigger value="checklists">Daily checklists</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <ComplianceOverviewTab scores={scores} employees={employees} isLoading={scoresLoading} />
        </TabsContent>

        <TabsContent value="alerts">
          <ComplianceAlertsTab
            onOpenViolation={(id) => {
              const match = violations.find((v) => v.id === id);
              if (match) setSelected(match);
              else setTab("violations");
            }}
            onOpenChecklists={() => setTab("checklists")}
          />
        </TabsContent>

        <TabsContent value="violations">
          <ViolationsTab
            violations={violations}
            isLoading={isLoading}
            filters={filters}
            onFilters={patchFilters}
            categories={categories}
            staff={staff}
            onNew={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            onSelect={setSelected}
            onExport={exportViolations}
          />
        </TabsContent>

        <TabsContent value="fines">
          <MunicipalityFinesTab
            fines={fines.fines}
            totals={fines.totals}
            isLoading={fines.isLoading}
            branchId={scopedBranchId}
            branchName={branchName}
            prefill={finePrefill}
            onPrefillConsumed={() => setFinePrefill(null)}
            onSave={(input) => fines.saveFine.mutateAsync(input)}
            onPost={(id) => fines.postToExpense.mutate(id)}
            saving={fines.saveFine.isPending}
            posting={fines.postToExpense.isPending}
          />
        </TabsContent>

        <TabsContent value="checklists">
          <ChecklistsTab
            branchId={scopedBranchId}
            branchName={branchName}
            canReview={isOwner || isManager}
          />
        </TabsContent>

        <TabsContent value="settings">
          <ComplianceSettingsTab canManage={isOwner || isManager} />
        </TabsContent>
      </Tabs>

      <ViolationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        branchId={scopedBranchId}
        branchName={branchName}
        staff={staff}
        existing={editing}
        saving={saveViolation.isPending}
        onSave={(input) => saveViolation.mutateAsync(input)}
      />

      <ViolationDetailSheet
        violation={selected}
        onOpenChange={(v) => !v && setSelected(null)}
        onChangeStatus={(id, status: ComplianceStatus) => changeStatus.mutate({ id, status })}
        onCreateFine={(v) => {
          setSelected(null);
          setFinePrefill({
            branch_id: v.branch_id,
            violation_id: v.id,
            fine_reference: v.municipality_reference ?? "",
            amount: Number(v.fine_amount || 0),
            inspection_date: v.inspection_date,
            violation_summary: v.description,
          });
          setTab("fines");
        }}
      />
    </div>
  );
}