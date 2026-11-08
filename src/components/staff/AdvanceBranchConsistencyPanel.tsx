import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";

interface MismatchRow {
  advance_id: string;
  staff_id: string;
  staff_name: string | null;
  advance_date: string;
  amount: number;
  status: string | null;
  advance_branch_id: string | null;
  advance_branch_name: string | null;
  staff_branch_id: string | null;
  staff_branch_name: string | null;
  ledger_leg_count: number | null;
  mismatched_leg_count: number | null;
}

/**
 * Branch consistency check: lists advances whose recorded branch differs from
 * the branch on the staff profile, and lets owners/managers realign them
 * (advance + ledger legs) in one click.
 */
export function AdvanceBranchConsistencyPanel() {
  const { hasRole } = useAuth();
  const { format: money } = useCurrency();
  const canFix = hasRole("owner") || hasRole("manager");
  const queryClient = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["advance-branch-mismatches"],
    queryFn: async () => {
      const { data, error } = await (
        supabase as unknown as {
          rpc: (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>;
        }
      ).rpc("list_advance_branch_mismatches");
      if (error) throw new Error(error.message);
      return (data ?? []) as MismatchRow[];
    },
    staleTime: 60_000,
  });

  const realign = useMutation({
    mutationFn: async (advanceId: string) => {
      const { data, error } = await (
        supabase as unknown as {
          rpc: (
            fn: string,
            args: Record<string, unknown>
          ) => Promise<{ data: unknown; error: { message: string } | null }>;
        }
      ).rpc("realign_advance_branch", { p_advance_id: advanceId });
      if (error) throw new Error(error.message);
      return data as { legs_updated?: number } | null;
    },
    onSuccess: (result) => {
      toast.success(
        `Advance realigned to the staff branch (${result?.legs_updated ?? 0} ledger legs updated)`
      );
      queryClient.invalidateQueries({ queryKey: ["advance-branch-mismatches"] });
      queryClient.invalidateQueries({ queryKey: ["advance-branch-audit"] });
      queryClient.invalidateQueries({ queryKey: ["staff-advances"] });
      queryClient.invalidateQueries({ queryKey: ["staff-advance-ledger"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={rows.length > 0 ? "border-amber-300" : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          {rows.length > 0 ? (
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          )}
          Branch consistency check
          {rows.length > 0 && (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
              {rows.length} mismatch{rows.length === 1 ? "" : "es"}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Compares each advance&apos;s recorded branch with the branch on the staff profile.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            All advances match the branch of their staff member.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Advance branch</TableHead>
                  <TableHead>Staff branch</TableHead>
                  <TableHead>Ledger legs</TableHead>
                  {canFix && <TableHead className="text-right">Fix</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.advance_id} className="bg-amber-50/60">
                    <TableCell className="whitespace-nowrap">{r.advance_date}</TableCell>
                    <TableCell className="font-medium">{r.staff_name ?? "Unknown"}</TableCell>
                    <TableCell className="text-right">{money(Number(r.amount || 0))}</TableCell>
                    <TableCell className="text-amber-700">
                      {r.advance_branch_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1">
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        {r.staff_branch_name ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.mismatched_leg_count ?? 0} of {r.ledger_leg_count ?? 0} on another branch
                    </TableCell>
                    {canFix && (
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={realign.isPending}
                          onClick={() => realign.mutate(r.advance_id)}
                        >
                          {realign.isPending && realign.variables === r.advance_id && (
                            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                          )}
                          Move to staff branch
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}