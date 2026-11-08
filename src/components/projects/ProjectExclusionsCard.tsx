import { useMemo } from "react";
import { ArrowUpRight, Filter } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useCurrency } from "@/hooks/useCurrency";
import { buildExclusionSummary } from "@/lib/projectExclusions";
import type { useProjects } from "@/hooks/useProjects";

type ProjectsApi = ReturnType<typeof useProjects>;

export function ProjectExclusionsCard({
  api,
  onOpenTransaction,
}: {
  api: ProjectsApi;
  onOpenTransaction?: (id: string) => void;
}) {
  const { format: money } = useCurrency();
  const summary = useMemo(() => buildExclusionSummary(api.transactions), [api.transactions]);

  if (summary.totalCount === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          Excluded from reconciliation
        </CardTitle>
        <CardDescription className="font-light">
          {summary.totalCount} transaction{summary.totalCount === 1 ? "" : "s"} ({money(summary.totalAmount)})
          are not part of the cost vs funding figures. Each group below explains why.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="w-full">
          {summary.groups.map((g) => (
            <AccordionItem key={g.reason} value={g.reason}>
              <AccordionTrigger className="text-sm">
                <div className="flex flex-1 items-center justify-between gap-3 pr-3">
                  <span className="flex items-center gap-2">
                    {g.title}
                    <Badge variant="secondary" className="font-light">
                      {g.count}
                    </Badge>
                  </span>
                  <span className="text-muted-foreground">{money(g.amount)}</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-2">
                <p className="text-xs font-light text-muted-foreground">{g.explanation}</p>
                <ul className="divide-y rounded-md border">
                  {g.items.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{i.label}</p>
                        <p className="text-xs font-light text-muted-foreground">{i.date ?? "—"}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span>{money(i.amount)}</span>
                        {onOpenTransaction && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => onOpenTransaction(i.id)}
                          >
                            View <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}
