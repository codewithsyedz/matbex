import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCurrency } from "@/hooks/useCurrency";
import type { useProjects } from "@/hooks/useProjects";

type ProjectsApi = ReturnType<typeof useProjects>;

/**
 * Investment summary that keeps the acquisition price strictly separate from
 * everything spent after the business was bought, and shows who funded what.
 */
export function ProjectInvestmentSummary({ api }: { api: ProjectsApi }) {
  const { format: money } = useCurrency();
  const { acquisition, transactions, funding, activeProject } = api;

  const posted = useMemo(
    () => transactions.filter((t) => t.status === "posted"),
    [transactions],
  );

  const buckets = useMemo(() => {
    const sum = (predicate: (t: (typeof posted)[number]) => boolean) =>
      posted.filter(predicate).reduce((s, t) => s + Number(t.amount), 0);

    const fitOut = sum((t) => !t.capitalize && t.treatment === "capex");
    const fixedAssets = sum((t) => !!t.capitalize);
    const preOpening = sum(
      (t) =>
        !t.capitalize &&
        ["pre_opening", "license", "deposit", "inventory"].includes(t.treatment ?? ""),
    );
    const opex = sum(
      (t) => !t.capitalize && ["opex", "other"].includes(t.treatment ?? ""),
    );
    return { fitOut, fixedAssets, preOpening, opex };
  }, [posted]);

  const acquisitionCost = Number(acquisition?.amount ?? 0);
  const postAcquisition =
    buckets.fitOut + buckets.fixedAssets + buckets.preOpening + buckets.opex;
  const totalInvestment = acquisitionCost + postAcquisition;

  const rows = [
    { label: "Business acquisition", value: acquisitionCost, accent: true },
    { label: "Renovation / fit-out", value: buckets.fitOut },
    { label: "Fixed assets (capitalised)", value: buckets.fixedAssets },
    { label: "Pre-opening, licences & deposits", value: buckets.preOpening },
    { label: "Operating expenses", value: buckets.opex },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">
            {activeProject?.name ?? "Project"} investment
          </CardTitle>
          <CardDescription>
            The acquisition price is never merged with post-acquisition investment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.label}>
                  <TableCell className="font-light">{r.label}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${r.accent ? "font-medium text-primary" : ""}`}
                  >
                    {money(r.value)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2">
                <TableCell className="font-medium">Post-acquisition investment</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {money(postAcquisition)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Total investment</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {money(totalInvestment)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Partner funding</CardTitle>
          <CardDescription>
            Capital is equity; loans and payables are amounts the business still owes. Neither is
            an ownership percentage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead className="text-right">Capital</TableHead>
                <TableHead className="text-right">Loan</TableHead>
                <TableHead className="text-right">Due to partner</TableHead>
                <TableHead className="text-right">Total funded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {funding.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No partner funding recorded yet.
                  </TableCell>
                </TableRow>
              )}
              {funding.map((p) => (
                <TableRow key={p.partner_id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-light">{p.partner_name}</span>
                      {p.unclassified_amount > 0 && (
                        <Badge variant="destructive" className="text-[10px] font-normal">
                          {money(p.unclassified_amount)} unclassified
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(p.capital_balance)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(p.loan_balance)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(p.payable_balance)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {money(p.total_funded)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {funding.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Outstanding to partners:{" "}
              {funding
                .filter((p) => p.loan_balance + p.payable_balance > 0)
                .map((p) => `${p.partner_name} ${money(p.loan_balance + p.payable_balance)}`)
                .join(" · ") || "none"}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}