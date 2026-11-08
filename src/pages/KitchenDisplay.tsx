import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { ChefHat, Clock, Play, Check, X, Settings as SettingsIcon, BarChart3 } from "lucide-react";
import { Link } from "react-router-dom";
import { useKdsStations, useKdsTickets, type KdsTicket } from "@/hooks/useKDS";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function elapsed(from: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function TicketCard({ ticket, onAdvance, onCancel }: {
  ticket: KdsTicket;
  onAdvance: (t: KdsTicket) => void;
  onCancel: (t: KdsTicket) => void;
}) {
  const { t } = useTranslation();
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const ageSec = Math.floor((Date.now() - new Date(ticket.created_at).getTime()) / 1000);
  const tone =
    ticket.status === "ready"
      ? "border-primary bg-primary/5"
      : ageSec > 600
      ? "border-destructive/60 bg-destructive/5"
      : ageSec > 300
      ? "border-amber-400 bg-amber-50/40 dark:bg-amber-950/20"
      : "border-border bg-card";

  const ctaLabel =
    ticket.status === "new"
      ? t("app.kds.cta.start")
      : ticket.status === "in_progress"
      ? t("app.kds.cta.ready")
      : t("app.kds.cta.served");

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2 }}
    >
      <Card className={cn("flex flex-col h-full border-2 transition-colors", tone)}>
        <div className="flex items-center justify-between p-3 border-b">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{ticket.ticket_number}</span>
            {ticket.table_label && (
              <Badge variant="secondary" className="text-xs">{t("app.kds.table")} {ticket.table_label}</Badge>
            )}
          </div>
          <div className="flex items-center gap-1 text-sm tabular-nums font-medium">
            <Clock className="h-3.5 w-3.5" />
            {elapsed(ticket.created_at)}
          </div>
        </div>

        <div className="flex-1 p-3 space-y-2 overflow-y-auto">
          {(ticket.items || []).map((it) => (
            <div key={it.id} className="flex items-start gap-2 text-sm">
              <span className="font-semibold w-6 shrink-0">{Number(it.quantity)}×</span>
              <div className="flex-1">
                <div className="font-medium leading-tight">
                  {it.name_snapshot}
                  {it.size_label && <span className="text-muted-foreground"> · {it.size_label}</span>}
                </div>
                {it.notes && (
                  <div className="text-xs text-amber-700 dark:text-amber-400 italic mt-0.5">
                    {it.notes}
                  </div>
                )}
              </div>
            </div>
          ))}
          {ticket.notes && (
            <div className="text-xs italic text-muted-foreground border-t pt-2 mt-2">
              {t("app.kds.note")}: {ticket.notes}
            </div>
          )}
        </div>

        <div className="p-2 border-t flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => onCancel(ticket)} title={t("app.kds.cancel")}>
            <X className="h-4 w-4" />
          </Button>
          <Button className="flex-1" onClick={() => onAdvance(ticket)}>
            {ticket.status === "new" && <Play className="h-4 w-4 mr-1" />}
            {ticket.status !== "new" && <Check className="h-4 w-4 mr-1" />}
            {ctaLabel}
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}

export default function KitchenDisplay() {
  const { t } = useTranslation();
  const { stations } = useKdsStations();
  const [stationId, setStationId] = useState<string | "all">("all");
  const { tickets, setTicketStatus } = useKdsTickets(stationId);

  const columns = useMemo(() => {
    const cols: Record<string, KdsTicket[]> = { new: [], in_progress: [], ready: [] };
    for (const t of tickets) {
      if (cols[t.status]) cols[t.status].push(t);
    }
    return cols;
  }, [tickets]);

  const advance = (t: KdsTicket) => {
    const next =
      t.status === "new" ? "in_progress" : t.status === "in_progress" ? "ready" : "served";
    setTicketStatus.mutate({ id: t.id, status: next as any });
  };
  const cancel = (t: KdsTicket) => setTicketStatus.mutate({ id: t.id, status: "cancelled" });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b bg-background sticky top-0 z-10 min-h-[56px]">
        <div className="flex items-center gap-3 min-w-[240px] flex-1">
          <ChefHat className="h-5 w-5 text-primary" />
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">{t("app.kds.title")}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Select value={stationId} onValueChange={(v) => setStationId(v as any)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("app.kds.allStations")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("app.kds.allStations")}</SelectItem>
              {stations.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" asChild>
            <Link to="/kds-stations" title={t("app.kds.stations")}><SettingsIcon className="h-4 w-4" /></Link>
          </Button>
          <Button variant="outline" size="icon" asChild>
            <Link to="/kds-report" title={t("app.kds.kitchenReport")}><BarChart3 className="h-4 w-4" /></Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 md:p-6 flex-1 overflow-hidden">
        {([
          { key: "new", label: t("app.kds.columns.incoming") },
          { key: "in_progress", label: t("app.kds.columns.preparing") },
          { key: "ready", label: t("app.kds.columns.ready") },
        ] as const).map((col) => (
          <div key={col.key} className="flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {col.label}
              </h2>
              <Badge variant="outline">{columns[col.key].length}</Badge>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              <AnimatePresence mode="popLayout">
                {columns[col.key].map((t) => (
                  <TicketCard key={t.id} ticket={t} onAdvance={advance} onCancel={cancel} />
                ))}
              </AnimatePresence>
              {columns[col.key].length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-8 border border-dashed rounded-md">
                  {t("app.kds.empty")}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
