import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/integrations/db/client";
import { zatcaReminderDue } from "@/lib/zatcaApplicationReminder";

type TrackedApp = {
  id: string; status: string; submitted_at: string | null; decision_at?: string | null;
  zatca_reply?: string | null; reminder_days?: number | null; status_changed_at?: string | null;
};
type Ev = { id: string; old_status: string | null; new_status: string; note: string | null; changed_at: string };

export function ZatcaStatusTracker({ app, L, statusLabel, portalUrl, locale }: {
  app: TrackedApp; L: (en: string, ar: string) => string; statusLabel: (s: string) => string; portalUrl: string; locale: string;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState(app.status);
  const [reply, setReply] = useState(app.zatca_reply ?? "");
  const [decision, setDecision] = useState((app.decision_at ?? "").slice(0, 10));
  const [days, setDays] = useState(String(app.reminder_days ?? 14));
  useEffect(() => {
    setStatus(app.status); setReply(app.zatca_reply ?? ""); setDecision((app.decision_at ?? "").slice(0, 10)); setDays(String(app.reminder_days ?? 14));
  }, [app.id, app.status, app.zatca_reply, app.decision_at, app.reminder_days]);

  const events = useQuery({
    queryKey: ["zatca-status-events", app.id],
    queryFn: async () => {
      const { data, error } = await db.from("zatca_application_status_events")
        .select("id, old_status, new_status, note, changed_at").eq("application_id", app.id).order("changed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Ev[];
    },
  });

  const update = useMutation({
    mutationFn: async () => {
      const n = Number(days);
      if (!Number.isInteger(n) || n < 1 || n > 90) throw new Error(L("Reminder must be 1–90 days", "التذكير من 1 إلى 90 يوماً"));
      const final = status === "approved" || status === "rejected";
      const { error } = await db.from("zatca_provider_applications").update({
        status, zatca_reply: reply.trim().slice(0, 2000) || null, reminder_days: n,
        decision_at: final ? (decision ? new Date(`${decision}T12:00:00+03:00`).toISOString() : null) : null,
        updated_at: new Date().toISOString(),
      }).eq("id", app.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(L("Status updated", "تم تحديث الحالة"));
      qc.invalidateQueries({ queryKey: ["zatca-provider-app"] });
      qc.invalidateQueries({ queryKey: ["zatca-status-events", app.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reminder = zatcaReminderDue(app);
  const fmt = (d: string) => new Date(d).toLocaleString(locale, { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" });
  const final = status === "approved" || status === "rejected";

  return (
    <div className="space-y-4 rounded-md border p-4">
      <h3 className="font-semibold">{L("Track status with ZATCA", "متابعة الحالة لدى الهيئة")}</h3>
      {reminder?.due && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <span className="flex items-center gap-2"><BellRing className="h-4 w-4" />{L(`Waiting ${reminder.daysWaiting} days — check ZATCA's site for a decision.`, `بانتظار الرد منذ ${reminder.daysWaiting} يوماً — راجع موقع الهيئة.`)}</span>
          <Button size="sm" variant="outline" onClick={() => window.open(portalUrl, "_blank", "noopener")}>{L("Check now", "تحقق الآن")}<ExternalLink className="ms-2 h-4 w-4" /></Button>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1"><Label>{L("Status", "الحالة")}</Label>
          <Select value={status} onValueChange={setStatus}><SelectTrigger aria-label={L("Status", "الحالة")}><SelectValue /></SelectTrigger>
            <SelectContent>{["submitted", "under_review", "approved", "rejected"].map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label>{L("Decision date", "تاريخ القرار")}</Label><Input type="date" dir="ltr" disabled={!final} value={decision} onChange={(e) => setDecision(e.target.value)} /></div>
        <div className="space-y-1"><Label>{L("Remind me after (days)", "ذكّرني بعد (أيام)")}</Label><Input type="number" min={1} max={90} dir="ltr" value={days} onChange={(e) => setDays(e.target.value)} /></div>
      </div>
      <div className="space-y-1"><Label>{L("ZATCA's reply", "رد الهيئة")}</Label><Textarea rows={2} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={L("Paste or summarise ZATCA's message", "الصق رسالة الهيئة أو لخّصها")} /></div>
      <Button disabled={update.isPending} onClick={() => update.mutate()}>{L("Save status", "حفظ الحالة")}</Button>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">{L("Status history", "سجل الحالات")}</h4>
        {!events.data?.length ? <p className="text-sm text-muted-foreground">{events.isLoading ? L("Loading…", "جارٍ التحميل…") : L("No changes yet", "لا توجد تغييرات بعد")}</p> :
          <ol className="space-y-1 text-sm">{events.data.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-2 border-s-2 border-primary/40 ps-3">
              <span className="text-muted-foreground">{fmt(e.changed_at)}</span>
              <span>{e.old_status ? `${statusLabel(e.old_status)} → ` : ""}<strong>{statusLabel(e.new_status)}</strong></span>
              {e.note && <span className="w-full text-muted-foreground">{e.note}</span>}
            </li>))}</ol>}
      </div>
    </div>
  );
}
