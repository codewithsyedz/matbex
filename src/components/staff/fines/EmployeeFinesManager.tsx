import { useState } from "react";
import { format, startOfMonth, subMonths } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Gavel, LayoutDashboard, Settings } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useEmployeeFines,
  useViolationTypes,
  type FineFilters,
  type FineStatus,
} from "@/hooks/useEmployeeFines";
import { CreateFineDialog } from "./CreateFineDialog";
import { EmployeeFinesTable } from "./EmployeeFinesTable";
import { FineComplianceSettings } from "./FineComplianceSettings";
import { FinesDashboard } from "./FinesDashboard";

const STATUSES: (FineStatus | "all")[] = [
  "all",
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "applied",
  "cancelled",
];

export function EmployeeFinesManager() {
  const { hasRole } = useAuth();
  const canApprove = hasRole("owner") || hasRole("manager") || hasRole("accountant");
  const { violationTypes } = useViolationTypes();

  const [filters, setFilters] = useState<FineFilters>({
    status: "all",
    from: format(startOfMonth(subMonths(new Date(), 2)), "yyyy-MM-dd"),
    to: format(new Date(), "yyyy-MM-dd"),
  });

  const { fines, isLoading } = useEmployeeFines(filters);

  return (
    <Tabs defaultValue="register" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="register" className="gap-2">
            <Gavel className="h-4 w-4" /> Fines register
          </TabsTrigger>
          <TabsTrigger value="overview" className="gap-2">
            <LayoutDashboard className="h-4 w-4" /> Overview
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" /> Compliance settings
          </TabsTrigger>
        </TabsList>
        {canApprove && <CreateFineDialog />}
      </div>

      <TabsContent value="register" className="space-y-4">
        <Card className="border-border/40">
          <CardContent className="pt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5">
              <Label className="text-xs">Status</Label>
              <Select
                value={filters.status ?? "all"}
                onValueChange={(v) => setFilters({ ...filters, status: v as FineStatus | "all" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "all" ? "All statuses" : s.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Violation type</Label>
              <Select
                value={filters.violationTypeId ?? "all"}
                onValueChange={(v) =>
                  setFilters({ ...filters, violationTypeId: v === "all" ? undefined : v })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All violations</SelectItem>
                  {violationTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name_en}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={filters.from ?? ""}
                onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={filters.to ?? ""}
                onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <EmployeeFinesTable fines={fines} isLoading={isLoading} canApprove={canApprove} />
      </TabsContent>

      <TabsContent value="overview">
        <FinesDashboard fines={fines} />
      </TabsContent>

      <TabsContent value="settings">
        <FineComplianceSettings canEdit={canApprove} />
      </TabsContent>
    </Tabs>
  );
}