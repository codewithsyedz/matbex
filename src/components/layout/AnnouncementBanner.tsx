import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertOctagon, AlertTriangle, ChevronLeft, ChevronRight, Info, Sparkles, Wrench, X } from "lucide-react";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

export type AnnouncementSeverity = "info" | "feature" | "maintenance" | "warning" | "critical";
export interface Announcement {
  id: string; title: string; body: string | null; severity: AnnouncementSeverity;
  link_url: string | null; link_label: string | null; starts_at: string; ends_at: string | null;
}

/** Each type has its own word and icon, so the banner never relies on colour alone. */
const LOOK: Record<AnnouncementSeverity, { word: string; icon: typeof Info; tone: string }> = {
  info: { word: "News", icon: Info, tone: "bg-primary/10 text-foreground border-primary/20" },
  feature: { word: "New", icon: Sparkles, tone: "bg-primary/10 text-foreground border-primary/20" },
  maintenance: { word: "Maintenance", icon: Wrench, tone: "bg-sky-500/10 text-foreground border-sky-500/30" },
  warning: { word: "Action needed", icon: AlertTriangle, tone: "bg-amber-500/15 text-foreground border-amber-500/40" },
  critical: { word: "Service issue", icon: AlertOctagon, tone: "bg-destructive/15 text-foreground border-destructive/40" },
};

/**
 * One announcement at a time (most urgent first), with arrows when there are more. Users can
 * close any but a critical one; closing is remembered per user (announcement_dismissals).
 */
export function AnnouncementBanner({ items, onDismiss, preview = false }: {
  items: Announcement[];
  onDismiss?: (id: string) => void;
  preview?: boolean;
}) {
  const [index, setIndex] = useState(0);
  if (!items.length) return null;
  const i = Math.min(index, items.length - 1);
  const a = items[i];
  const look = LOOK[a.severity] ?? LOOK.info;
  const Icon = look.icon;
  const external = a.link_url?.startsWith("https://");

  return (
    <div role={a.severity === "critical" || a.severity === "warning" ? "alert" : "status"}
      className={`flex items-start gap-3 border-b px-4 py-2.5 text-sm md:px-6 ${look.tone}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <span className="me-2 text-xs font-semibold uppercase tracking-wide">{look.word}</span>
        <span className="font-medium">{a.title}</span>
        {a.body && <span className="text-muted-foreground"> {a.body}</span>}
        {a.link_url && (
          external || preview
            ? <a href={a.link_url} target={external ? "_blank" : undefined} rel="noreferrer" className="ms-2 font-medium underline underline-offset-2">{a.link_label || "Learn more"}</a>
            : <Link to={a.link_url} className="ms-2 font-medium underline underline-offset-2">{a.link_label || "Learn more"}</Link>
        )}
      </div>
      {items.length > 1 && (
        <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <button type="button" aria-label="Previous announcement" className="rounded p-0.5 hover:bg-foreground/10" onClick={() => setIndex((i - 1 + items.length) % items.length)}>
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
          </button>
          <span className="tabular-nums">{i + 1}/{items.length}</span>
          <button type="button" aria-label="Next announcement" className="rounded p-0.5 hover:bg-foreground/10" onClick={() => setIndex((i + 1) % items.length)}>
            <ChevronRight className="h-4 w-4 rtl:rotate-180" />
          </button>
        </div>
      )}
      {a.severity !== "critical" && (
        <button type="button" aria-label="Close announcement" className="shrink-0 rounded p-0.5 hover:bg-foreground/10"
          onClick={() => { if (!preview) onDismiss?.(a.id); }}>
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** The live banner for the signed-in user, refreshed every 5 minutes and on focus. */
export function ActiveAnnouncements() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["active-announcements", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("active_announcements");
      if (error) throw error;
      return (data ?? []) as Announcement[];
    },
  });
  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("announcement_dismissals").insert({ announcement_id: id, user_id: user!.id });
      if (error && error.code !== "23505") throw error;
    },
    onMutate: (id) => {
      qc.setQueryData<Announcement[]>(["active-announcements", user?.id], (cur) => (cur ?? []).filter((a) => a.id !== id));
    },
  });
  if (!q.data?.length) return null;
  return <AnnouncementBanner items={q.data} onDismiss={(id) => dismiss.mutate(id)} />;
}
