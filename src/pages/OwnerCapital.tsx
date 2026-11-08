import { useMemo, useState } from "react";
import { format, startOfYear } from "date-fns";
import { Banknote, Download, Plus, RotateCcw, TrendingDown, TrendingUp, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { BranchScopeSelector } from "@/components/branches/BranchScopeSelector";
import { CapitalAuditTimeline } from "@/components/accounting/CapitalAuditTimeline";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useOwnerCapital } from "@/hooks/useOwnerCapital";
import { exportToCSV } from "@/lib/exportUtils";
import { toast } from "sonner";

export default function OwnerCapital() {
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const scopedBranchId = pinnedBranchId ?? activeBranchId ?? null;
  const { format: money } = useCurrency();
  const { accounts: coa } = useChartOfAccounts();

  const [from, setFrom] = useState(format(startOfYear(new Date()), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [timelineAccountId, setTimelineAccountId] = useState<string | null>(null);
  const [tab, setTab] = useState("accounts");

  const { summaries, movements, totals, isLoading, createAccount, postMovement, reverseMovement } =
    useOwnerCapital({ branchId: scopedBranchId, from, to });

  const branchName = (id: string | null | undefined) =>
    id ? branches.find((b) => b.id === id)?.name ?? "Unknown branch" : "All branches";

  const cashAccounts = useMemo(
    () =>
      (coa ?? []).filter(
        (a: any) => a.account_type === "asset" && a.is_active && String(a.account_code) < "1500",
      ),
    [coa],
  );

  const accountLabel = (id: string) => {
    const a = summaries.find((s) => s.equity_account_id === id);
    return a ? `${a.partner_name} - ${a.bank_name} ..${a.account_last4}` : id;
  };
  const movementAccountLabel = (capitalAccountId: string) => {
    const a = summaries.find((s) => s.id === capitalAccountId);
    return a ? `${a.partner_name} - ${a.bank_name} ..${a.account_last4}` : "-";
  };

  // ---- Dialog: new capital account -----------------------------------
  const [accountOpen, setAccountOpen] = useState(false);
  const [partnerName, setPartnerName] = useState("");
  const [bankName, setBankName] = useState("");
  const [last4, setLast4] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [accountBranch, setAccountBranch] = useState<string>("shared");
  const [notes, setNotes] = useState("");

  const submitAccount = async () => {
    if (!partnerName.trim() || !bankName.trim() || !/^\d{4}$/.test(last4)) {
      toast.error("Partner name, bank name and a 4-digit account ending are required");
      return;
    }
    try {
      await createAccount.mutateAsync({
        partnerName,
        bankName,
        last4,
        branchId: accountBranch === "shared" ? null : accountBranch,
        openingBalance: Number(openingBalance) || 0,
        notes: notes.trim() || null,
      });
      toast.success("Capital account created under Equity");
      setAccountOpen(false);
      setPartnerName("");
      setBankName("");
      setLast4("");
      setOpeningBalance("0");
      setNotes("");
    } catch (e: any) {
      toast.error(e.message ?? "Could not create the capital account");
    }
  };

  // ---- Dialog: record movement ---------------------------------------
  const [movementOpen, setMovementOpen] = useState(false);
  const [movementAccount, setMovementAccount] = useState("");
  const [movementType, setMovementType] = useState<"injection" | "withdrawal">("injection");
  const [counterAccount, setCounterAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [movementDate, setMovementDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");

  const openMovement = (capitalAccountId?: string, type: "injection" | "withdrawal" = "injection") => {
    setMovementAccount(capitalAccountId ?? summaries[0]?.id ?? "");
    setMovementType(type);
    setMovementOpen(true);
  };

  const submitMovement = async () => {
    if (!movementAccount || !counterAccount || !(Number(amount) > 0)) {
      toast.error("Pick a capital account, a cash/bank account and an amount");
      return;
    }
    try {
      await postMovement.mutateAsync({
        capitalAccountId: movementAccount,
        counterAccountId: counterAccount,
        movementType,
        amount: Number(amount),
        movementDate,
        branchId: scopedBranchId,
        referenceNumber: reference.trim() || null,
        description: description.trim() || null,
      });
      toast.success(
        movementType === "injection"
          ? "Capital injection posted to the ledger"
          : "Capital withdrawal posted to the ledger",
      );
      setMovementOpen(false);
      setAmount("");
      setReference("");
      setDescription("");
    } catch (e: any) {
      toast.error(e.message ?? "Could not post the movement");
    }
  };

  const doReverse = async (id: string) => {
    const reason = window.prompt("Reason for reversing this capital movement?");
    if (reason === null) return;
    try {
      await reverseMovement.mutateAsync({ movementId: id, reason });
      toast.success("Reversal posted");
    } catch (e: any) {
      toast.error(e.message ?? "Could not reverse the movement");
    }
  };

  // ---- Exports --------------------------------------------------------
  const exportAccounts = () => {
    exportToCSV({
      headers: [
        "Partner",
        "Bank",
        "Account ending",
        "Branch",
        "Opening",
        "Injections",
        "Withdrawals",
        "Balance",
      ],
      rows: summaries.map((s) => [
        s.partner_name,
        s.bank_name,
        `..${s.account_last4}`,
        branchName(s.branch_id),
        Number(s.opening_balance).toFixed(2),
        s.injections.toFixed(2),
        s.withdrawals.toFixed(2),
        s.balance.toFixed(2),
      ]),
      filename: `Owner_Capital_${branchName(scopedBranchId).replace(/[^a-zA-Z0-9]+/g, "-")}`,
    });
  };

  const exportMovements = () => {
    exportToCSV({
      headers: ["Date", "Partner account", "Type", "Branch", "Reference", "Description", "Amount", "Status"],
      rows: movements.map((m) => [
        m.movement_date,
        movementAccountLabel(m.capital_account_id),
        m.movement_type === "injection" ? "Injection" : "Withdrawal",
        branchName(m.branch_id),
        m.reference_number ?? "-",
        m.description ?? "-",
        Number(m.amount).toFixed(2),
        m.is_reversed ? "Reversed" : "Posted",
      ]),
      filename: `Capital_Movements_${from}_${to}`,
    });
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Owner Capital Accounts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Partner bank accounts held under Equity. Injections increase business cash and partner
            capital; withdrawals reduce both.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <BranchScopeSelector hint="Accounts and movements follow this branch" />
          <Button variant="outline" onClick={() => setAccountOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New capital account
          </Button>
          <Button onClick={() => openMovement()} disabled={summaries.length === 0}>
            <Banknote className="h-4 w-4 mr-2" />
            Record movement
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Opening capital</CardDescription>
            <CardTitle className="text-base font-medium">{money(totals.opening)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" /> Injections
            </CardDescription>
            <CardTitle className="text-base font-medium">{money(totals.injections)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-1">
              <TrendingDown className="h-3.5 w-3.5" /> Withdrawals
            </CardDescription>
            <CardTitle className="text-base font-medium">{money(totals.withdrawals)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription className="flex items-center gap-1">
              <Wallet className="h-3.5 w-3.5" /> Closing capital
            </CardDescription>
            <CardTitle className="text-base font-medium">{money(totals.balance)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label htmlFor="from">From</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[160px]" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to">To</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[160px]" />
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={exportAccounts}>
              <Download className="h-4 w-4 mr-2" /> Export accounts
            </Button>
            <Button variant="outline" size="sm" onClick={exportMovements}>
              <Download className="h-4 w-4 mr-2" /> Export movements
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="accounts">Capital accounts</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
          <TabsTrigger value="timeline">Audit timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead>Bank</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right">Injections</TableHead>
                    <TableHead className="text-right">Withdrawals</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                        Loading…
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && summaries.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                        No capital accounts yet. Create one to start tracking partner injections and
                        withdrawals.
                      </TableCell>
                    </TableRow>
                  )}
                  {summaries.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.partner_name}</TableCell>
                      <TableCell>
                        {s.bank_name}{" "}
                        <span className="text-muted-foreground">••{s.account_last4}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{branchName(s.branch_id)}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{money(Number(s.opening_balance))}</TableCell>
                      <TableCell className="text-right text-emerald-600">{money(s.injections)}</TableCell>
                      <TableCell className="text-right text-destructive">{money(s.withdrawals)}</TableCell>
                      <TableCell className="text-right font-medium">{money(s.balance)}</TableCell>
                      <TableCell className="text-right space-x-2 whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => openMovement(s.id, "injection")}>
                          Inject
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openMovement(s.id, "withdrawal")}>
                          Withdraw
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setTimelineAccountId(s.id);
                            setTab("timeline");
                          }}
                        >
                          Timeline
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movements" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Partner account</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                        No movements in this period.
                      </TableCell>
                    </TableRow>
                  )}
                  {movements.map((m) => (
                    <TableRow key={m.id} className={m.is_reversed ? "opacity-60" : undefined}>
                      <TableCell>{m.movement_date}</TableCell>
                      <TableCell>{movementAccountLabel(m.capital_account_id)}</TableCell>
                      <TableCell>
                        <Badge variant={m.movement_type === "injection" ? "default" : "secondary"}>
                          {m.movement_type === "injection" ? "Injection" : "Withdrawal"}
                        </Badge>
                      </TableCell>
                      <TableCell>{branchName(m.branch_id)}</TableCell>
                      <TableCell className="text-muted-foreground">{m.reference_number ?? "-"}</TableCell>
                      <TableCell className="text-right">{money(Number(m.amount))}</TableCell>
                      <TableCell className="text-right">
                        {m.is_reversed ? (
                          <Badge variant="outline">Reversed</Badge>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => doReverse(m.id)}>
                            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reverse
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="timeline" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-sm">Account</Label>
            <Select
              value={timelineAccountId ?? ""}
              onValueChange={(v) => setTimelineAccountId(v)}
            >
              <SelectTrigger className="w-[320px]">
                <SelectValue placeholder="Select a capital account" />
              </SelectTrigger>
              <SelectContent>
                {summaries.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.partner_name} - {s.bank_name} ..{s.account_last4}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <CapitalAuditTimeline
            capitalAccountId={timelineAccountId}
            accountLabel={timelineAccountId ? movementAccountLabel(timelineAccountId) : undefined}
            branchName={branchName}
          />
        </TabsContent>
      </Tabs>


      {/* New capital account */}
      <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New owner capital account</DialogTitle>
            <DialogDescription>
              Creates an Equity account in the chart of accounts named "Partner - Bank ..1234".
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-3">
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Partner name</Label>
                <Input value={partnerName} onChange={(e) => setPartnerName(e.target.value)} placeholder="Syed Hussain" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Bank</Label>
                  <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Al Rajhi" />
                </div>
                <div className="space-y-1">
                  <Label>Account last 4 digits</Label>
                  <Input
                    value={last4}
                    onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="1234"
                    inputMode="numeric"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Opening balance</Label>
                  <Input
                    type="number"
                    value={openingBalance}
                    onChange={(e) => setOpeningBalance(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Branch</Label>
                  <Select value={accountBranch} onValueChange={setAccountBranch}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-50 bg-popover">
                      <SelectItem value="shared">Shared (all branches)</SelectItem>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccountOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitAccount} disabled={createAccount.isPending}>
              Create account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record movement */}
      <Dialog open={movementOpen} onOpenChange={setMovementOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record capital movement</DialogTitle>
            <DialogDescription>
              {movementType === "injection"
                ? "Debit business cash/bank, credit the partner's capital account."
                : "Debit the partner's capital account, credit business cash/bank."}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-3">
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Partner capital account</Label>
                <Select value={movementAccount} onValueChange={setMovementAccount}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent className="z-50 bg-popover">
                    {summaries.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.partner_name} - {s.bank_name} ••{s.account_last4}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Type</Label>
                  <Select value={movementType} onValueChange={(v) => setMovementType(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-50 bg-popover">
                      <SelectItem value="injection">Capital injection</SelectItem>
                      <SelectItem value="withdrawal">Capital withdrawal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Date</Label>
                  <Input type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Business cash / bank account</Label>
                <Select value={counterAccount} onValueChange={setCounterAccount}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select cash or bank account" />
                  </SelectTrigger>
                  <SelectContent className="z-50 bg-popover">
                    {cashAccounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.account_code} — {a.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Amount</Label>
                  <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Reference</Label>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transfer #" />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
              </div>
              <p className="text-xs text-muted-foreground">
                Posting: {movementType === "injection" ? "DR cash/bank · CR" : "DR"}{" "}
                {movementAccount ? accountLabel(
                  summaries.find((s) => s.id === movementAccount)?.equity_account_id ?? "",
                ) : "partner capital"}{" "}
                {movementType === "injection" ? "" : "· CR cash/bank"}
              </p>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovementOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitMovement} disabled={postMovement.isPending}>
              Post to ledger
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
