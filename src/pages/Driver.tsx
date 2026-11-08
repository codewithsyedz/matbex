import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bike, MapPin, Navigation, Phone, CheckCircle2, Package, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Assignment = {
  id: string;
  order_id: string;
  status: "assigned" | "picked_up" | "delivered" | "cancelled";
  delivery_address: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  assigned_at: string;
  picked_up_at: string | null;
  notes: string | null;
};

type DriverState = {
  rider: { id: string; name: string; phone: string | null; vehicle: string | null; status: string };
  assignments: Assignment[];
};

export default function Driver() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<DriverState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const { data, error: err } = await supabase.rpc("driver_get_state" as any, { _token: token });
    if (err) {
      setError(err.message);
    } else if ((data as any)?.error) {
      setError((data as any).error);
    } else {
      setState(data as unknown as DriverState);
      setError(null);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 20s
  useEffect(() => {
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);

  // GPS ping every 60s while page open (best-effort)
  useEffect(() => {
    if (!token || !("geolocation" in navigator)) return;
    const ping = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          supabase.rpc("driver_ping_location" as any, {
            _token: token,
            _lat: pos.coords.latitude,
            _lng: pos.coords.longitude,
          });
        },
        () => {},
        { enableHighAccuracy: false, maximumAge: 30_000, timeout: 10_000 },
      );
    };
    ping();
    const id = setInterval(ping, 60_000);
    return () => clearInterval(id);
  }, [token]);

  const update = async (id: string, status: "picked_up" | "delivered") => {
    setBusy(id);
    const { data, error: err } = await supabase.rpc("driver_update_assignment" as any, {
      _token: token!, _assignment_id: id, _status: status,
    });
    setBusy(null);
    if (err || (data as any)?.error) {
      toast.error(err?.message || (data as any)?.error);
      return;
    }
    toast.success(status === "delivered" ? "Marked delivered" : "Marked picked up");
    load();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="p-8 text-center max-w-sm">
          <Bike className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <h1 className="text-lg font-medium mb-2">Driver link invalid</h1>
          <p className="text-sm text-muted-foreground">
            This link is no longer active. Ask your manager for a new one.
          </p>
        </Card>
      </div>
    );
  }

  const { rider, assignments } = state;

  return (
    <div className="min-h-screen bg-muted/30 pb-20">
      {/* Header */}
      <header className="bg-background border-b sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Bike className="w-5 h-5 text-primary" />
              <h1 className="font-medium">{rider.name}</h1>
            </div>
            <p className="text-xs text-muted-foreground capitalize">
              {rider.vehicle || "—"} · {rider.status.replace("_", " ")}
            </p>
          </div>
          <Button size="icon" variant="ghost" onClick={load} aria-label="Refresh">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-4 space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-medium text-muted-foreground">
            Active deliveries ({assignments.length})
          </h2>
        </div>

        {assignments.length === 0 && (
          <Card className="p-10 text-center">
            <Package className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No deliveries assigned right now.</p>
            <p className="text-xs text-muted-foreground/70 mt-1">This page will update automatically.</p>
          </Card>
        )}

        {assignments.map((a) => {
          const mapsUrl = a.delivery_lat && a.delivery_lng
            ? `https://www.google.com/maps/dir/?api=1&destination=${a.delivery_lat},${a.delivery_lng}`
            : a.delivery_address
              ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a.delivery_address)}`
              : null;
          return (
            <Card key={a.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-xs text-muted-foreground">
                    #{a.order_id.slice(0, 8)}
                  </div>
                  <div className="mt-1 text-sm font-medium flex items-start gap-1.5">
                    <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <span>{a.delivery_address || "Address not provided"}</span>
                  </div>
                </div>
                <Badge variant={a.status === "picked_up" ? "default" : "outline"} className="shrink-0">
                  {a.status === "picked_up" ? "On the way" : "To pickup"}
                </Badge>
              </div>

              {a.notes && (
                <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">{a.notes}</p>
              )}

              <div className="grid grid-cols-2 gap-2">
                {mapsUrl && (
                  <Button asChild variant="outline" size="lg" className="h-12">
                    <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
                      <Navigation className="w-4 h-4 mr-1.5" /> Navigate
                    </a>
                  </Button>
                )}
                {rider.phone && (
                  <Button asChild variant="outline" size="lg" className="h-12">
                    <a href={`tel:${rider.phone}`}>
                      <Phone className="w-4 h-4 mr-1.5" /> Call
                    </a>
                  </Button>
                )}
              </div>

              <div className="pt-1">
                {a.status === "assigned" ? (
                  <Button
                    size="lg"
                    className="w-full h-12"
                    disabled={busy === a.id}
                    onClick={() => update(a.id, "picked_up")}
                  >
                    <Package className="w-4 h-4 mr-1.5" /> Mark picked up
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    className="w-full h-12 bg-emerald-600 hover:bg-emerald-700"
                    disabled={busy === a.id}
                    onClick={() => update(a.id, "delivered")}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-1.5" /> Mark delivered
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </main>
    </div>
  );
}