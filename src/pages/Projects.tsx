import { useState } from "react";
import { AlertTriangle, FolderKanban, Plus } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjectAcquisitionTab } from "@/components/projects/ProjectAcquisitionTab";
import { ProjectBudgetTab } from "@/components/projects/ProjectBudgetTab";
import { ProjectDashboardTab } from "@/components/projects/ProjectDashboardTab";
import { ProjectFundingTab } from "@/components/projects/ProjectFundingTab";
import { ProjectOverviewTab } from "@/components/projects/ProjectOverviewTab";
import { ProjectSetupDialog } from "@/components/projects/ProjectSetupDialog";
import { ProjectTransactionsTab } from "@/components/projects/ProjectTransactionsTab";
import { useProjects } from "@/hooks/useProjects";

export default function Projects() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [focusTxnId, setFocusTxnId] = useState<string | null>(null);
  const api = useProjects(selectedId);
  const project = api.activeProject;

  const openTransaction = (id: string) => {
    setFocusTxnId(id);
    setTab("transactions");
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <FolderKanban className="h-6 w-6 text-primary" />
            Projects &amp; Cost Centers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track acquisition, construction and pre-opening spend separately from operating results.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {api.projects.length > 0 && (
            <Select value={project?.id ?? ""} onValueChange={setSelectedId}>
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {api.projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button onClick={() => setSetupOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New project
          </Button>
        </div>
      </div>

      {api.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : !project ? (
        <Card>
          <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
            <FolderKanban className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No projects yet. Create one to start capturing setup and construction costs.
            </p>
            <Button onClick={() => setSetupOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Create project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{project.phase.replace("_", " ")}</Badge>
            {api.totals.needsReviewCount > 0 && (
              <Badge variant="destructive">{api.totals.needsReviewCount} need review</Badge>
            )}
          </div>

          {!api.reconciliation.balanced && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Project cost and funding do not reconcile</AlertTitle>
              <AlertDescription>
                Cost {api.reconciliation.costTotal.toLocaleString()} · Funding{" "}
                {api.reconciliation.fundingTotal.toLocaleString()} · Variance{" "}
                {api.reconciliation.variance.toLocaleString()}. {api.reconciliation.unpostedCount} unposted,{" "}
                {api.reconciliation.unclassifiedCount} unclassified and {api.reconciliation.excludedCount}{" "}
                excluded transactions.
              </AlertDescription>
            </Alert>
          )}

          {api.reconciliation.balanced && api.reconciliation.unclassifiedCount > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Project reconciles — review queue still has items</AlertTitle>
              <AlertDescription>
                {api.reconciliation.unclassifiedCount} unrelated transaction(s) still need classification. They
                do not affect the current cost vs funding balance.
              </AlertDescription>
            </Alert>
          )}

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="transactions">
                Transactions
                {api.totals.needsReviewCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[10px] text-destructive-foreground">
                    {api.totals.needsReviewCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="budget">Budget</TabsTrigger>
              <TabsTrigger value="funding">Partner funding</TabsTrigger>
              <TabsTrigger value="acquisition">Acquisition</TabsTrigger>
            </TabsList>

            <TabsContent value="dashboard" className="mt-4">
              <ProjectDashboardTab api={api} />
            </TabsContent>
            <TabsContent value="overview" className="mt-4">
              <ProjectOverviewTab api={api} onOpenTransaction={openTransaction} />
            </TabsContent>
            <TabsContent value="transactions" className="mt-4">
              <ProjectTransactionsTab api={api} focusTransactionId={focusTxnId} />
            </TabsContent>
            <TabsContent value="budget" className="mt-4">
              <ProjectBudgetTab api={api} />
            </TabsContent>
            <TabsContent value="funding" className="mt-4">
              <ProjectFundingTab api={api} />
            </TabsContent>
            <TabsContent value="acquisition" className="mt-4">
              <ProjectAcquisitionTab api={api} />
            </TabsContent>
          </Tabs>
        </>
      )}

      <ProjectSetupDialog open={setupOpen} onOpenChange={setSetupOpen} />
    </div>
  );
}