import { useMemo, useState } from "react";
import { subDays } from "date-fns";
import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { BarChart3, Building2, LayoutDashboard, RefreshCw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BranchScopeSelector } from "@/components/branches/BranchScopeSelector";
import { ManagerOverview } from "@/components/manager/ManagerOverview";
import { ManagerBranches } from "@/components/manager/ManagerBranches";
import { ManagerTrends } from "@/components/manager/ManagerTrends";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const RANGES = [
  { key: "7", label: "7d", days: 7 },
  { key: "30", label: "30d", days: 30 },
  { key: "90", label: "90d", days: 90 },
] as const;

/**
 * Management app shell — the screen the Capacitor Android "manager" build
 * lands on. Mobile-first, branch-aware, read-only reporting: today's
 * performance, branch comparison and sales trends.
 */
export default function ManagerApp() {
  const { restaurant } = useAuth();
  const { activeBranch, isAllBranches } = useBranch();
  const queryClient = useQueryClient();
  const [rangeKey, setRangeKey] = useState<(typeof RANGES)[number]["key"]>("30");
  const [refreshing, setRefreshing] = useState(false);

  const days = RANGES.find((r) => r.key === rangeKey)!.days;
  const to = useMemo(() => new Date(), [rangeKey]);
  const from = useMemo(() => subDays(to, days - 1), [to, days]);

  const scopeLabel = isAllBranches ? "All branches" : activeBranch?.name ?? "Primary branch";

  const refresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setTimeout(() => setRefreshing(false), 600);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background pb-10">
      <div className="mx-auto max-w-md space-y-4 p-4">
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="flex items-start justify-between gap-3"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Smartphone className="h-3 w-3" />
              Management
            </div>
            <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight truncate">{restaurant?.name ?? "Matbex"}</h1>
            <p className="text-sm text-muted-foreground mt-1">{scopeLabel}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline" className="text-[10px]">Live</Badge>
            <Button size="icon" variant="ghost" onClick={refresh} aria-label="Refresh data">
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </Button>
          </div>
        </motion.header>

        <BranchScopeSelector hint="Every card and chart below follows this branch" />

        <div className="flex gap-2">
          {RANGES.map((r) => (
            <Button
              key={r.key}
              size="sm"
              variant={rangeKey === r.key ? "default" : "outline"}
              className="h-8 flex-1 rounded-xl"
              onClick={() => setRangeKey(r.key)}
            >
              {r.label}
            </Button>
          ))}
        </div>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-3 rounded-xl">
            <TabsTrigger value="overview" className="gap-1.5 text-xs">
              <LayoutDashboard className="h-3.5 w-3.5" /> Overview
            </TabsTrigger>
            <TabsTrigger value="branches" className="gap-1.5 text-xs">
              <Building2 className="h-3.5 w-3.5" /> Branches
            </TabsTrigger>
            <TabsTrigger value="trends" className="gap-1.5 text-xs">
              <BarChart3 className="h-3.5 w-3.5" /> Trends
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <ManagerOverview from={from} to={to} />
          </TabsContent>
          <TabsContent value="branches" className="mt-4">
            <ManagerBranches from={from} to={to} />
          </TabsContent>
          <TabsContent value="trends" className="mt-4">
            <ManagerTrends from={from} to={to} />
          </TabsContent>
        </Tabs>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <Button asChild variant="outline" className="h-12 rounded-2xl">
            <NavLink to="/daily-profit">Full P&amp;L</NavLink>
          </Button>
          <Button asChild variant="outline" className="h-12 rounded-2xl">
            <NavLink to="/reports">Reports</NavLink>
          </Button>
        </div>
      </div>
    </div>
  );
}