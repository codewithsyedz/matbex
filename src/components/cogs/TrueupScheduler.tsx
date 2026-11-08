import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CalendarClock, Plus, Trash2, BellRing } from "lucide-react";
import { toast } from "sonner";
import { format as fmtDate } from "date-fns";

const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export function TrueupScheduler() {
  const { restaurant, user } = useAuth();
  const qc = useQueryClient();
  const restaurantId = restaurant?.id;
  const tenantId = (restaurant as any)?.tenant_id;

  const [draft, setDraft] = useState({
    frequency: "weekly" as "weekly" | "daily",
    stocktake_kind: "weekly" as "weekly" | "daily",
    day_of_week: 1,
    hour_of_day: 2,
    correct_wac: false,
    notify_self: true,
  });

  const { data: schedules = [] } = useQuery({
    queryKey: ["cogs-trueup-schedules", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cogs_trueup_schedules" as any)
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("cogs_trueup_schedules" as any).insert({
        tenant_id: tenantId,
        restaurant_id: restaurantId,
        frequency: draft.frequency,
        stocktake_kind: draft.stocktake_kind,
        day_of_week: draft.frequency === "weekly" ? draft.day_of_week : null,
        hour_of_day: draft.hour_of_day,
        correct_wac: draft.correct_wac,
        notify_user_ids: draft.notify_self && user?.id ? [user.id] : [],
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Schedule created");
      qc.invalidateQueries({ queryKey: ["cogs-trueup-schedules", restaurantId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to create schedule"),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("cogs_trueup_schedules" as any).update({ enabled }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cogs-trueup-schedules", restaurantId] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("cogs_trueup_schedules" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Schedule removed");
      qc.invalidateQueries({ queryKey: ["cogs-trueup-schedules", restaurantId] });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" />
          Scheduled true-ups
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-md border p-4 space-y-3 bg-muted/20">
          <div className="text-sm font-medium">Add a schedule</div>
          <div className="grid md:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Frequency</Label>
              <Select value={draft.frequency} onValueChange={(v) => setDraft({ ...draft, frequency: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Stocktake type</Label>
              <Select value={draft.stocktake_kind} onValueChange={(v) => setDraft({ ...draft, stocktake_kind: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draft.frequency === "weekly" && (
              <div>
                <Label className="text-xs">Day</Label>
                <Select value={String(draft.day_of_week)} onValueChange={(v) => setDraft({ ...draft, day_of_week: Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOW.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs">Hour (24h)</Label>
              <Select value={String(draft.hour_of_day)} onValueChange={(v) => setDraft({ ...draft, hour_of_day: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, h) => (
                    <SelectItem key={h} value={String(h)}>{String(h).padStart(2,"0")}:00</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={() => create.mutate()} disabled={create.isPending} className="w-full">
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 pt-1">
            <div className="flex items-center gap-2">
              <Switch checked={draft.correct_wac} onCheckedChange={(v) => setDraft({ ...draft, correct_wac: v })} id="sched-wac" />
              <Label htmlFor="sched-wac" className="text-xs">Re-base WAC after run</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={draft.notify_self} onCheckedChange={(v) => setDraft({ ...draft, notify_self: v })} id="sched-notify" />
              <Label htmlFor="sched-notify" className="text-xs flex items-center gap-1">
                <BellRing className="h-3 w-3" /> Notify me when complete
              </Label>
            </div>
          </div>
        </div>

        {schedules.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No scheduled true-ups yet. The runner checks every 15 minutes.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Frequency</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Stocktake</TableHead>
                <TableHead>WAC</TableHead>
                <TableHead>Next run</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead className="text-right">Enabled</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(schedules as any[]).map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="capitalize">{s.frequency}</TableCell>
                  <TableCell className="text-xs">
                    {s.frequency === "weekly" ? `${DOW[s.day_of_week ?? 1]} ` : ""}
                    {String(s.hour_of_day).padStart(2,"0")}:00
                  </TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px] capitalize">{s.stocktake_kind}</Badge></TableCell>
                  <TableCell>{s.correct_wac ? <Badge variant="secondary" className="text-[10px]">Re-base</Badge> : <span className="text-xs text-muted-foreground">-</span>}</TableCell>
                  <TableCell className="text-xs">{s.next_run_at ? fmtDate(new Date(s.next_run_at), "MMM d, HH:mm") : "-"}</TableCell>
                  <TableCell className="text-xs">
                    {s.last_run_at ? (
                      <span title={s.last_status ?? ""}>
                        {fmtDate(new Date(s.last_run_at), "MMM d, HH:mm")}
                        {s.last_status?.startsWith("error") && <Badge variant="destructive" className="ml-1 text-[10px]">error</Badge>}
                      </span>
                    ) : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch checked={s.enabled} onCheckedChange={(v) => toggle.mutate({ id: s.id, enabled: v })} />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => remove.mutate(s.id)}>
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}