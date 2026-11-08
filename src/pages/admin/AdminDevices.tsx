import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Laptop, Loader2, RefreshCw, Search, ShieldOff, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

interface DeviceRow {
  id: string;
  restaurant_id: string;
  tenant_id: string;
  terminal_id: string;
  device_label: string | null;
  platform: string | null;
  user_agent: string | null;
  claimed_at: string;
  last_seen_at: string;
  device_fingerprint: string | null;
}

interface RestaurantRow {
  id: string;
  name: string;
  tenant_id: string;
}

interface SeatRow {
  restaurant_id: string;
  seat_count: number;
}

interface RestaurantGroup {
  restaurant: RestaurantRow;
  devices: DeviceRow[];
  cap: number;
}

export default function AdminDevices() {
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const devicesQuery = useQuery({
    queryKey: ["admin-devices"],
    queryFn: async () => {
      const [devicesRes, restaurantsRes, seatsRes] = await Promise.all([
        supabase
          .from("device_licenses" as never)
          .select(
            "id, restaurant_id, tenant_id, terminal_id, device_label, platform, user_agent, claimed_at, last_seen_at, device_fingerprint",
          )
          .is("revoked_at", null)
          .order("last_seen_at", { ascending: false }),
        supabase.from("restaurants").select("id, name, tenant_id"),
        supabase.from("branch_license_seats" as never).select("restaurant_id, seat_count"),
      ]);
      if (devicesRes.error) throw devicesRes.error;
      if (restaurantsRes.error) throw restaurantsRes.error;
      return {
        devices: (devicesRes.data as unknown as DeviceRow[]) ?? [],
        restaurants: (restaurantsRes.data as unknown as RestaurantRow[]) ?? [],
        seats: ((seatsRes.data as unknown as SeatRow[]) ?? []),
      };
    },
  });

  const groups = useMemo<RestaurantGroup[]>(() => {
    const data = devicesQuery.data;
    if (!data) return [];
    const seatMap = new Map(data.seats.map((s) => [s.restaurant_id, s.seat_count]));
    const restById = new Map(data.restaurants.map((r) => [r.id, r]));
    const byRest = new Map<string, DeviceRow[]>();
    for (const d of data.devices) {
      if (!byRest.has(d.restaurant_id)) byRest.set(d.restaurant_id, []);
      byRest.get(d.restaurant_id)!.push(d);
    }
    const result: RestaurantGroup[] = [];
    for (const [rid, devs] of byRest) {
      const restaurant =
        restById.get(rid) ?? { id: rid, name: "Unknown restaurant", tenant_id: devs[0]?.tenant_id ?? "" };
      result.push({ restaurant, devices: devs, cap: seatMap.get(rid) ?? 1 });
    }
    result.sort((a, b) => a.restaurant.name.localeCompare(b.restaurant.name));
    return result;
  }, [devicesQuery.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        devices: g.devices.filter(
          (d) =>
            g.restaurant.name.toLowerCase().includes(q) ||
            d.device_label?.toLowerCase().includes(q) ||
            d.terminal_id.toLowerCase().includes(q) ||
            d.platform?.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.devices.length > 0 || g.restaurant.name.toLowerCase().includes(q));
  }, [groups, search]);

  const totals = useMemo(() => {
    const totalDevices = groups.reduce((s, g) => s + g.devices.length, 0);
    const overLimit = groups.filter((g) => g.devices.length > g.cap).length;
    return { totalDevices, totalRestaurants: groups.length, overLimit };
  }, [groups]);

  async function callAdminAction(payload: Record<string, unknown>, successMsg: string) {
    const { data, error } = await supabase.functions.invoke("admin-device-actions", {
      body: payload,
    });
    if (error) {
      toast.error(error.message ?? "Action failed");
      return false;
    }
    if ((data as { error?: string } | null)?.error) {
      toast.error((data as { error: string }).error);
      return false;
    }
    toast.success(successMsg);
    return true;
  }

  async function handleRevoke(device: DeviceRow) {
    if (!confirm(`Revoke this device (${device.device_label || device.terminal_id.slice(0, 8)})?`)) return;
    setBusy(device.id);
    const ok = await callAdminAction(
      { action: "revoke", device_id: device.id },
      "Device revoked",
    );
    setBusy(null);
    if (ok) devicesQuery.refetch();
  }

  async function handleReset(group: RestaurantGroup) {
    if (
      !confirm(
        `Reset ALL ${group.devices.length} device${group.devices.length === 1 ? "" : "s"} for "${group.restaurant.name}"? Every terminal will need to re-claim a seat.`,
      )
    )
      return;
    setBusy(group.restaurant.id);
    const ok = await callAdminAction(
      { action: "reset_restaurant", restaurant_id: group.restaurant.id },
      `Reset ${group.devices.length} device${group.devices.length === 1 ? "" : "s"}`,
    );
    setBusy(null);
    if (ok) devicesQuery.refetch();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Licensed Devices
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            View every active POS terminal across all tenants. Revoke a single seat or reset a
            whole restaurant.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => devicesQuery.refetch()}
          disabled={devicesQuery.isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${devicesQuery.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border/40">
          <CardHeader className="pb-2">
            <CardDescription>Active devices</CardDescription>
            <CardTitle className="text-3xl font-light">{totals.totalDevices}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/40">
          <CardHeader className="pb-2">
            <CardDescription>Restaurants</CardDescription>
            <CardTitle className="text-3xl font-light">{totals.totalRestaurants}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/40">
          <CardHeader className="pb-2">
            <CardDescription>Over seat limit</CardDescription>
            <CardTitle className="text-3xl font-light text-amber-500">
              {totals.overLimit}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search restaurant, device label, terminal id, platform…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {devicesQuery.isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-border/40">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No active devices match your search.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filtered.map((group) => {
            const over = group.devices.length > group.cap;
            return (
              <Card key={group.restaurant.id} className="border-border/40">
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div className="space-y-1">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      <Laptop className="h-4 w-4 text-muted-foreground" />
                      {group.restaurant.name}
                      {over && (
                        <Badge variant="destructive" className="text-xs">
                          Over limit
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="font-mono text-xs">
                      {group.devices.length} / {group.cap} seat
                      {group.cap === 1 ? "" : "s"} used · tenant {group.restaurant.tenant_id.slice(0, 8)}…
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleReset(group)}
                    disabled={busy === group.restaurant.id}
                  >
                    {busy === group.restaurant.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4 mr-1" />
                        Reset all
                      </>
                    )}
                  </Button>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Device</TableHead>
                        <TableHead>Platform</TableHead>
                        <TableHead>Claimed</TableHead>
                        <TableHead>Last seen</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.devices.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="max-w-[280px]">
                            <div className="text-sm font-medium truncate">
                              {d.device_label || d.terminal_id.slice(0, 12)}
                            </div>
                            <div className="text-xs text-muted-foreground truncate font-mono">
                              {d.terminal_id}
                              {d.device_fingerprint && (
                                <span className="ml-2 opacity-60">
                                  fp:{d.device_fingerprint.slice(0, 10)}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{d.platform || "-"}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {format(new Date(d.claimed_at), "MMM d, yyyy")}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {format(new Date(d.last_seen_at), "MMM d, HH:mm")}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRevoke(d)}
                              disabled={busy === d.id}
                            >
                              {busy === d.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <ShieldOff className="h-4 w-4 mr-1" />
                                  Revoke
                                </>
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}