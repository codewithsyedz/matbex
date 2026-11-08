import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CalendarCheck, Copy, Users } from "lucide-react";
import { toast } from "sonner";

interface Reservation {
  id: string;
  guest_name: string;
  guest_phone: string;
  guest_email: string | null;
  party_size: number;
  reserved_date: string;
  reserved_time: string;
  notes: string | null;
  status: string;
  created_at: string;
}

const STATUSES = ["pending", "confirmed", "seated", "cancelled", "no_show"] as const;

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting",
  confirmed: "Confirmed",
  seated: "Seated",
  cancelled: "Cancelled",
  no_show: "No show",
};

export default function Reservations() {
  const { restaurant } = useAuth();
  const restaurantId = restaurant?.id;
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));

  const bookingUrl = restaurantId ? `${window.location.origin}/book/${restaurantId}` : "";

  const { data, isLoading } = useQuery({
    queryKey: ["table-reservations", restaurantId, from],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("table_reservations")
        .select("*")
        .eq("restaurant_id", restaurantId!)
        .gte("reserved_date", from)
        .order("reserved_date", { ascending: true })
        .order("reserved_time", { ascending: true });
      if (error) throw error;
      return (data || []) as Reservation[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await (supabase as any)
        .from("table_reservations")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["table-reservations"] });
      toast.success("Booking updated");
    },
    onError: () => toast.error("Could not update the booking"),
  });

  const totals = useMemo(() => {
    const list = data || [];
    return {
      all: list.length,
      pending: list.filter((r) => r.status === "pending").length,
      covers: list
        .filter((r) => r.status !== "cancelled" && r.status !== "no_show")
        .reduce((sum, r) => sum + r.party_size, 0),
    };
  }, [data]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Table bookings</h1>
          <p className="text-sm text-muted-foreground">Requests from your public booking page.</p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">From</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => {
              navigator.clipboard.writeText(bookingUrl);
              toast.success("Booking link copied");
            }}
          >
            <Copy className="mr-2 h-4 w-4" /> Copy booking link
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Bookings</CardDescription>
            <CardTitle className="text-3xl">{totals.all}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Waiting to confirm</CardDescription>
            <CardTitle className="text-3xl">{totals.pending}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Expected guests</CardDescription>
            <CardTitle className="text-3xl">{totals.covers}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarCheck className="h-5 w-5 text-primary" /> Upcoming
          </CardTitle>
          <CardDescription className="break-all">{bookingUrl}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && (data || []).length === 0 && (
            <p className="text-sm text-muted-foreground">No bookings yet. Share your booking link with guests.</p>
          )}
          {(data || []).map((r) => (
            <div
              key={r.id}
              className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.guest_name}</span>
                  <Badge variant={r.status === "pending" ? "secondary" : "outline"}>
                    {STATUS_LABEL[r.status] || r.status}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {r.reserved_date} · {r.reserved_time?.slice(0, 5)} ·{" "}
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {r.party_size}
                  </span>{" "}
                  · {r.guest_phone}
                </p>
                {r.notes && <p className="text-sm text-muted-foreground">{r.notes}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {STATUSES.filter((s) => s !== r.status).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => setStatus.mutate({ id: r.id, status: s })}
                  >
                    {STATUS_LABEL[s]}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
