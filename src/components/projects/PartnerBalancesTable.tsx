import { useMemo, useState } from "react";
import { ArrowUpDown, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useCurrency } from "@/hooks/useCurrency";
import type { PartnerFunding, ProjectPartner } from "@/hooks/useProjects";

type SortKey = "partner" | "capital" | "loan" | "payable" | "net";

/**
 * Partner management summary: one row per partner with their equity (capital),
 * loan and payable balances plus the linked ledger accounts.
 */
export function PartnerBalancesTable({
  funding,
  partners,
}: {
  funding: PartnerFunding[];
  partners: ProjectPartner[];
}) {
  const { format: money } = useCurrency();
  const { accounts } = useChartOfAccounts();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("net");

  const accountLabel = (id: string | null | undefined) => {
    if (!id) return "—";
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.account_code} ${a.account_name}` : "—";
  };

  const rows = useMemo(() => {
    const list = funding.map((f) => {
      const p = partners.find((x) => x.id === f.partner_id);
      const capital = Number(f.capital_balance);
      const loan = Number(f.loan_balance);
      const payable = Number(f.payable_balance);
      return {
        id: f.partner_id,
        name: f.partner_name,
        ownership: Number(f.ownership_pct),
        capital,
        loan,
        payable,
        net: capital + loan + payable,
        repayable: loan + payable,
        active: p?.is_active ?? true,
        capitalAccount: accountLabel(p?.capital_account_id),
        loanAccount: accountLabel(p?.loan_account_id),
        payableAccount: accountLabel(p?.payable_account_id),
      };
    });
    const q = query.trim().toLowerCase();
    const filtered = q ? list.filter((r) => r.name.toLowerCase().includes(q)) : list;
    return [...filtered].sort((a, b) => {
      if (sort === "partner") return a.name.localeCompare(b.name);
      return Number(b[sort]) - Number(a[sort]);
    });
  }, [funding, partners, accounts, query, sort]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          capital: acc.capital + r.capital,
          loan: acc.loan + r.loan,
          payable: acc.payable + r.payable,
          net: acc.net + r.net,
          ownership: acc.ownership + r.ownership,
        }),
        { capital: 0, loan: 0, payable: 0, net: 0, ownership: 0 },
      ),
    [rows],
  );

  const sortButton = (key: SortKey, label: string) => (
    <Button
      variant="ghost"
      size="sm"
      className="-mr-2 h-7 px-1.5 font-normal"
      onClick={() => setSort(key)}
    >
      {label}
      <ArrowUpDown className={`ml-1 h-3 w-3 ${sort === key ? "text-primary" : "opacity-40"}`} />
    </Button>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> Partner balances
          </CardTitle>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search partner"
            className="h-8 w-full sm:w-56"
          />
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{sortButton("partner", "Partner")}</TableHead>
              <TableHead className="text-right">Ownership</TableHead>
              <TableHead className="text-right">{sortButton("capital", "Capital (equity)")}</TableHead>
              <TableHead className="text-right">{sortButton("loan", "Loan")}</TableHead>
              <TableHead className="text-right">{sortButton("payable", "Payable")}</TableHead>
              <TableHead className="text-right">{sortButton("net", "Net position")}</TableHead>
              <TableHead>Ledger accounts</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">
                  {r.name}
                  {!r.active && (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">{r.ownership.toFixed(2)}%</TableCell>
                <TableCell className="text-right">{money(r.capital)}</TableCell>
                <TableCell className="text-right">{money(r.loan)}</TableCell>
                <TableCell className="text-right">{money(r.payable)}</TableCell>
                <TableCell className="text-right font-medium">
                  {money(r.net)}
                  {r.repayable > 0 && (
                    <span className="ml-2 text-xs font-light text-muted-foreground">
                      {money(r.repayable)} repayable
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-xs font-light text-muted-foreground">
                  <div>Capital: {r.capitalAccount}</div>
                  <div>Loan: {r.loanAccount}</div>
                  <div>Payable: {r.payableAccount}</div>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  No partners match this view.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">Total</TableCell>
                <TableCell className="text-right">{totals.ownership.toFixed(2)}%</TableCell>
                <TableCell className="text-right">{money(totals.capital)}</TableCell>
                <TableCell className="text-right">{money(totals.loan)}</TableCell>
                <TableCell className="text-right">{money(totals.payable)}</TableCell>
                <TableCell className="text-right font-medium">{money(totals.net)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          Net position = capital + loan + payable. Loan and payable balances are repayable to the
          partner; capital stays in equity until a withdrawal is posted.
        </p>
      </CardContent>
    </Card>
  );
}
