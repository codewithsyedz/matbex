import { useMemo } from "react";
import { addMonths, format, parseISO } from "date-fns";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCurrency } from "@/hooks/useCurrency";

interface Props {
  /** Capitalised cost (excluding recoverable VAT and finance charges). */
  cost: number;
  /** In-service / acquisition date (ISO yyyy-MM-dd). */
  startDate: string;
  usefulLifeMonths: number;
  depreciationMethod?: "straight_line" | "reducing_balance" | string;
  salvageRatePct?: number;
  /** Depreciation already posted to the ledger for this asset, if it exists. */
  accumulatedPosted?: number;
}

interface YearRow {
  label: string;
  charge: number;
  closing: number;
  months: number;
}

export function DepreciationSchedulePreview({
  cost,
  startDate,
  usefulLifeMonths,
  depreciationMethod = "straight_line",
  salvageRatePct = 0,
  accumulatedPosted = 0,
}: Props) {
  const { format: money } = useCurrency();

  const model = useMemo(() => {
    const base = Math.max(Number(cost) || 0, 0);
    const life = Math.max(Math.round(Number(usefulLifeMonths) || 0), 1);
    const salvage = Math.round(base * (Number(salvageRatePct) || 0)) / 100;
    const depreciable = Math.max(base - salvage, 0);

    let start: Date;
    try {
      start = parseISO(startDate);
      if (Number.isNaN(start.getTime())) start = new Date();
    } catch {
      start = new Date();
    }

    const reducing = depreciationMethod === "reducing_balance";
    const monthlyRate = reducing
      ? salvage > 0 && base > 0
        ? 1 - Math.pow(salvage / base, 1 / life)
        : Math.min(2 / life, 0.9)
      : 0;
    const straightMonthly = Math.round((depreciable / life) * 100) / 100;

    const rows: { period: number; date: Date; charge: number; closing: number }[] = [];
    let nbv = base;
    for (let i = 1; i <= life; i++) {
      let charge = reducing ? Math.round(nbv * monthlyRate * 100) / 100 : straightMonthly;
      if (i === life && !reducing) charge = Math.round((nbv - salvage) * 100) / 100;
      charge = Math.max(Math.min(charge, Math.round((nbv - salvage) * 100) / 100), 0);
      nbv = Math.round((nbv - charge) * 100) / 100;
      rows.push({ period: i, date: addMonths(start, i - 1), charge, closing: nbv });
    }

    const years: YearRow[] = [];
    rows.forEach((r, idx) => {
      const y = Math.floor(idx / 12);
      if (!years[y]) {
        years[y] = { label: `Year ${y + 1}`, charge: 0, closing: r.closing, months: 0 };
      }
      years[y].charge = Math.round((years[y].charge + r.charge) * 100) / 100;
      years[y].closing = r.closing;
      years[y].months += 1;
    });

    // Months elapsed since in-service date -> projected position today
    const now = new Date();
    const elapsed = Math.max(
      0,
      Math.min(
        life,
        (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1,
      ),
    );
    const projectedAccum = rows.slice(0, elapsed).reduce((s, r) => s + r.charge, 0);
    const projectedNbv = Math.round((base - projectedAccum) * 100) / 100;
    const postedNbv = Math.round((base - (Number(accumulatedPosted) || 0)) * 100) / 100;

    return {
      base,
      life,
      salvage,
      rows,
      years,
      firstMonthly: rows[0]?.charge ?? 0,
      endDate: rows.length ? rows[rows.length - 1].date : start,
      elapsed,
      projectedAccum: Math.round(projectedAccum * 100) / 100,
      projectedNbv,
      postedNbv,
      reducing,
    };
  }, [cost, startDate, usefulLifeMonths, depreciationMethod, salvageRatePct, accumulatedPosted]);

  if (!model.base) {
    return (
      <p className="text-xs text-muted-foreground">
        Add a purchase amount to preview the depreciation schedule.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Capitalised cost" value={money(model.base)} />
        <Stat
          label={model.reducing ? "First month charge" : "Monthly charge"}
          value={money(model.firstMonthly)}
        />
        <Stat label="Residual / salvage" value={money(model.salvage)} />
        <Stat label="Fully depreciated" value={format(model.endDate, "MMM yyyy")} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={`Projected charge to date (${model.elapsed} mo)`} value={money(model.projectedAccum)} />
        <Stat label="Projected remaining value" value={money(model.projectedNbv)} emphasis />
        <Stat label="Remaining value (posted)" value={money(model.postedNbv)} />
      </div>

      <ScrollArea className="max-h-56">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Depreciation</TableHead>
              <TableHead className="text-right">Remaining value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {model.years.map((y) => (
              <TableRow key={y.label}>
                <TableCell className="text-xs">
                  {y.label}
                  <span className="ml-1 text-muted-foreground">({y.months} mo)</span>
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">{money(y.charge)}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{money(y.closing)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      <p className="text-[11px] text-muted-foreground">
        {model.reducing ? "Reducing balance" : "Straight line"} over {model.life} months from{" "}
        {format(model.rows[0].date, "dd MMM yyyy")}. Finance charges are expensed separately and are not
        capitalised.
      </p>
    </div>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={emphasis ? "text-sm font-semibold text-primary" : "text-sm font-medium"}>{value}</p>
    </div>
  );
}
