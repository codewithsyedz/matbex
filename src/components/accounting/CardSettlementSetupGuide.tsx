import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Check, ChevronDown, CircleAlert, CircleDashed, Pencil, Settings2, Wand2 } from "lucide-react";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
interface CoaRow {
  id: string;
  account_code: string;
  account_name: string;
  is_active: boolean;
}

interface Props {
  /** Card takings already routed into 1015 (debits). */
  cardTakings: number;
  /** Number of acquirer payouts recorded so far. */
  payoutCount: number;
}

type StepState = "done" | "todo" | "warn";

/**
 * Guided setup for card handling: makes sure 1015 exists, the destination bank
 * account is named after the real business account, and fees have a home.
 */
export function CardSettlementSetupGuide({ cardTakings, payoutCount }: Props) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<CoaRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["card-setup-accounts", tenantId],
    enabled: !!tenantId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await db
        .from("chart_of_accounts")
        .select("id, account_code, account_name, is_active")
        .eq("tenant_id", tenantId)
        .in("account_code", ["1010", "1015", "6620"]);
      if (error) throw error;
      const rows = (data ?? []) as CoaRow[];
      return {
        clearing: rows.find((r) => r.account_code === "1015") ?? null,
        bank: rows.find((r) => r.account_code === "1010") ?? null,
        fees: rows.find((r) => r.account_code === "6620") ?? null,
      };
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["card-setup-accounts"] });
    qc.invalidateQueries({ queryKey: ["card-clearing-accounts"] });
    qc.invalidateQueries({ queryKey: ["chart-of-accounts"] });
  };

  const createAccount = async (
    key: string,
    code: string,
    name: string,
    type: "asset" | "expense",
    description: string,
  ) => {
    if (!tenantId) return;
    setBusy(key);
    try {
      const { error } = await db.from("chart_of_accounts").insert({
        tenant_id: tenantId,
        account_code: code,
        account_name: name,
        account_type: type,
        description,
        is_active: true,
      });
      if (error) throw error;
      toast.success(`${code} ${name} created`);
      refresh();
    } catch (e: any) {
      toast.error("Could not create the account", { description: e?.message ?? "Unknown error" });
    } finally {
      setBusy(null);
    }
  };

  const activate = async (key: string, row: CoaRow) => {
    setBusy(key);
    try {
      const { error } = await db
        .from("chart_of_accounts")
        .update({ is_active: true })
        .eq("id", row.id);
      if (error) throw error;
      toast.success(`${row.account_code} reactivated`);
      refresh();
    } catch (e: any) {
      toast.error("Could not reactivate the account", { description: e?.message ?? "Unknown error" });
    } finally {
      setBusy(null);
    }
  };

  const saveRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setBusy("rename");
    try {
      const { error } = await db
        .from("chart_of_accounts")
        .update({ account_name: renameValue.trim() })
        .eq("id", renameTarget.id);
      if (error) throw error;
      toast.success("Bank account renamed", { description: renameValue.trim() });
      setRenameTarget(null);
      refresh();
    } catch (e: any) {
      toast.error("Could not rename the account", { description: e?.message ?? "Unknown error" });
    } finally {
      setBusy(null);
    }
  };

  const clearing = data?.clearing ?? null;
  const bank = data?.bank ?? null;
  const fees = data?.fees ?? null;

  const genericBankName = !!bank && /^(bank account|bank|primary)/i.test(bank.account_name.trim());

  const steps: {
    key: string;
    title: string;
    body: string;
    state: StepState;
    action?: React.ReactNode;
  }[] = [
    {
      key: "clearing",
      title: "Create 1015 Card Settlements Receivable",
      body:
        "Card takings land here at day end instead of going straight to the bank, so the ledger shows money the acquirer still owes you.",
      state: clearing ? (clearing.is_active ? "done" : "warn") : "todo",
      action: !clearing ? (
        <Button
          size="sm"
          className="gap-1.5"
          disabled={busy === "clearing"}
          onClick={() =>
            createAccount(
              "clearing",
              "1015",
              "Card Settlements Receivable",
              "asset",
              "Card takings in transit until the acquirer payout lands in the bank.",
            )
          }
        >
          <Wand2 className="h-3.5 w-3.5" />
          {busy === "clearing" ? "Creating…" : "Create account"}
        </Button>
      ) : !clearing.is_active ? (
        <Button size="sm" variant="outline" disabled={busy === "clearing"} onClick={() => activate("clearing", clearing)}>
          Reactivate
        </Button>
      ) : undefined,
    },
    {
      key: "bank",
      title: "Point 1010 at your real business bank account",
      body: bank
        ? `Payouts clear into "${bank.account_name}". Rename it to the actual account (e.g. Al Rajhi – Current 1234) so statements reconcile cleanly.`
        : "Account 1010 is missing. Add your company bank account so payouts have a destination.",
      state: !bank ? "todo" : genericBankName ? "warn" : "done",
      action: bank ? (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => {
            setRenameTarget(bank);
            setRenameValue(bank.account_name);
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
          Rename
        </Button>
      ) : (
        <Button
          size="sm"
          className="gap-1.5"
          disabled={busy === "bank"}
          onClick={() =>
            createAccount("bank", "1010", "Bank Account – Primary", "asset", "Company business bank account.")
          }
        >
          <Wand2 className="h-3.5 w-3.5" />
          {busy === "bank" ? "Creating…" : "Create account"}
        </Button>
      ),
    },
    {
      key: "fees",
      title: "Keep 6620 Bank Charges for acquirer fees",
      body:
        "The fee deducted from each payout is expensed here, so gross card revenue stays intact and margin reporting stays accurate.",
      state: fees ? (fees.is_active ? "done" : "warn") : "todo",
      action: !fees ? (
        <Button
          size="sm"
          className="gap-1.5"
          disabled={busy === "fees"}
          onClick={() =>
            createAccount("fees", "6620", "Bank Charges", "expense", "Acquirer and bank processing fees.")
          }
        >
          <Wand2 className="h-3.5 w-3.5" />
          {busy === "fees" ? "Creating…" : "Create account"}
        </Button>
      ) : !fees.is_active ? (
        <Button size="sm" variant="outline" disabled={busy === "fees"} onClick={() => activate("fees", fees)}>
          Reactivate
        </Button>
      ) : undefined,
    },
    {
      key: "routing",
      title: "Confirm card sales are routing to 1015",
      body:
        cardTakings > 0
          ? "Day-end sales postings are debiting the clearing account — nothing more to do here."
          : "Nothing has hit 1015 yet. It fills automatically from the next day-end sales posting that includes card payments.",
      state: cardTakings > 0 ? "done" : "todo",
      action:
        cardTakings > 0 ? undefined : (
          <Button size="sm" variant="outline" asChild>
            <Link to="/accounting">Open ledger</Link>
          </Button>
        ),
    },
    {
      key: "payout",
      title: "Record the first acquirer payout",
      body:
        "When the bank credit arrives, record the payout so 1015 clears into your bank account and the fee is expensed.",
      state: payoutCount > 0 ? "done" : "todo",
    },
  ];

  const doneCount = steps.filter((s) => s.state === "done").length;
  const allDone = doneCount === steps.length;

  return (
    <>
      <Card className={cn(!allDone && "border-primary/40")}>
        <Collapsible open={open || !allDone} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer flex-row items-start justify-between gap-3 space-y-0 pb-3">
              <div>
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <Settings2 className="h-4 w-4 text-primary" />
                  Card handling setup
                </CardTitle>
                <CardDescription>
                  {allDone
                    ? "Your chart of accounts is ready for card settlements."
                    : "Finish these steps so card takings, payouts and fees post to the right accounts."}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={allDone ? "outline" : "secondary"}>
                  {doneCount}/{steps.length} done
                </Badge>
                <ChevronDown className={cn("h-4 w-4 transition-transform", (open || !allDone) && "rotate-180")} />
              </div>
            </CardHeader>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <CardContent className="space-y-3">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
              ) : (
                steps.map((s, i) => (
                  <div
                    key={s.key}
                    className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex gap-3">
                      <div className="pt-0.5">
                        {s.state === "done" ? (
                          <Check className="h-4 w-4 text-primary" />
                        ) : s.state === "warn" ? (
                          <CircleAlert className="h-4 w-4 text-amber-500" />
                        ) : (
                          <CircleDashed className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <p className={cn("text-sm font-medium", s.state === "done" && "text-muted-foreground")}>
                          {i + 1}. {s.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 font-light">{s.body}</p>
                      </div>
                    </div>
                    {s.action && <div className="sm:shrink-0 sm:pl-3">{s.action}</div>}
                  </div>
                ))
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename bank account 1010</DialogTitle>
            <DialogDescription>
              Use the real account name so payouts and bank statements match line for line.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Account name</Label>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="e.g. Al Rajhi Bank – Current 1234"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button onClick={saveRename} disabled={!renameValue.trim() || busy === "rename"}>
              {busy === "rename" ? "Saving…" : "Save name"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
