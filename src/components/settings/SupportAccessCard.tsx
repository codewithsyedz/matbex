import { useQuery } from "@tanstack/react-query";
import { differenceInMinutes, format } from "date-fns";
import { Headset, Loader2 } from "lucide-react";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Row { id: string; actor_name: string | null; reason: string; started_at: string; ended_at: string | null; support_requests: { number: number } | null }

/** Owners: every time Matbex support viewed this business, by whom, why and for how long. */
export function SupportAccessCard() {
  const { tenant, hasRole } = useAuth();
  const isOwner = hasRole("owner");
  const q = useQuery({
    queryKey: ["support-access-log", tenant?.id],
    enabled: !!tenant?.id && isOwner,
    queryFn: async () => {
      const { data, error } = await db.from("support_access_log")
        .select("id, actor_name, reason, started_at, ended_at, support_requests:request_id(number)")
        .eq("tenant_id", tenant!.id).order("started_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });
  if (!isOwner) return null;

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-medium"><Headset className="h-4 w-4" />Support access</CardTitle>
        <CardDescription>Each time the Matbex team opened your account to help, with the reason they gave.</CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : !q.data?.length ? (
          <p className="text-sm text-muted-foreground">Matbex support has not accessed your account.</p>
        ) : (
          <ul className="divide-y text-sm">
            {q.data.map((r) => {
              const mins = r.ended_at ? differenceInMinutes(new Date(r.ended_at), new Date(r.started_at)) : null;
              return (
                <li key={r.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2">
                  <div className="min-w-0">
                    <div>{r.reason}{r.support_requests ? <span className="text-muted-foreground"> (request #{r.support_requests.number})</span> : null}</div>
                    <div className="text-xs text-muted-foreground">{r.actor_name ?? "Matbex support"}</div>
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(r.started_at), "d MMM yyyy, HH:mm")} · {mins == null ? "in progress" : `${Math.max(mins, 1)} min`}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
