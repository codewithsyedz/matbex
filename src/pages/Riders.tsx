import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Bike, Plus, Truck, MapPin, CheckCircle2, Link2, Zap, Inbox } from "lucide-react";
import { toast } from "sonner";

export default function Riders() {
  const { restaurant } = useAuth();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", vehicle: "motorbike" });

  const riders = useQuery({
    queryKey: ["riders", restaurant?.id],
    enabled: !!restaurant?.id,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("riders" as any)
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const assignments = useQuery({
    queryKey: ["delivery-assignments", restaurant?.id],
    enabled: !!restaurant?.id,
    staleTime: 20_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("delivery_assignments" as any)
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .in("status", ["assigned", "picked_up"])
        .order("assigned_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const unassigned = useQuery({
    queryKey: ["unassigned-deliveries", restaurant?.id],
    enabled: !!restaurant?.id,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("v_unassigned_delivery_orders" as any)
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const autoDispatch = useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await db.rpc("auto_assign_rider" as any, { _order_id: orderId });
      if (error) throw error;
      return data as string | null;
    },
    onSuccess: (assignmentId) => {
      qc.invalidateQueries({ queryKey: ["unassigned-deliveries", restaurant?.id] });
      qc.invalidateQueries({ queryKey: ["delivery-assignments", restaurant?.id] });
      qc.invalidateQueries({ queryKey: ["riders", restaurant?.id] });
      if (assignmentId) toast.success("Rider auto-assigned");
      else toast.warning("No available riders right now");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dispatchAll = async () => {
    const orders = unassigned.data ?? [];
    if (orders.length === 0) return;
    let assigned = 0;
    for (const o of orders) {
      try {
        const { data } = await db.rpc("auto_assign_rider" as any, { _order_id: o.id });
        if (data) assigned++;
      } catch {/* ignore individual failures */}
    }
    qc.invalidateQueries({ queryKey: ["unassigned-deliveries", restaurant?.id] });
    qc.invalidateQueries({ queryKey: ["delivery-assignments", restaurant?.id] });
    qc.invalidateQueries({ queryKey: ["riders", restaurant?.id] });
    toast.success(`Dispatched ${assigned}/${orders.length} orders`);
  };

  const addRider = useMutation({
    mutationFn: async () => {
      if (!restaurant?.id) throw new Error("No restaurant");
      const { error } = await db.from("riders" as any).insert({
        restaurant_id: restaurant.id,
        name: form.name,
        phone: form.phone || null,
        vehicle: form.vehicle,
        status: "offline",
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["riders", restaurant?.id] });
      toast.success("Rider added");
      setShowAdd(false);
      setForm({ name: "", phone: "", vehicle: "motorbike" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await db.from("riders" as any).update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["riders", restaurant?.id] }),
  });

  const updateAssignment = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const patch: any = { status };
      if (status === "picked_up") patch.picked_up_at = new Date().toISOString();
      if (status === "delivered") patch.delivered_at = new Date().toISOString();
      const { error } = await db.from("delivery_assignments" as any).update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["delivery-assignments", restaurant?.id] });
      qc.invalidateQueries({ queryKey: ["riders", restaurant?.id] });
    },
  });

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      available: "bg-success/10 text-success border-success/30",
      on_delivery: "bg-primary/10 text-primary border-primary/30",
      offline: "bg-muted text-muted-foreground border-border",
    };
    return <Badge variant="outline" className={map[s] || ""}>{s.replace("_", " ")}</Badge>;
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex items-center justify-between min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Rider Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Roster, assignments, and live status.</p>
        </div>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-1" /> Add rider</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add rider</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div>
                <Label>Vehicle</Label>
                <Select value={form.vehicle} onValueChange={(v) => setForm({ ...form, vehicle: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="motorbike">Motorbike</SelectItem>
                    <SelectItem value="car">Car</SelectItem>
                    <SelectItem value="bicycle">Bicycle</SelectItem>
                    <SelectItem value="scooter">Scooter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button onClick={() => addRider.mutate()} disabled={!form.name || addRider.isPending}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="roster">
        <TabsList>
          <TabsTrigger value="roster"><Bike className="w-4 h-4 mr-2" />Roster</TabsTrigger>
          <TabsTrigger value="dispatch">
            <Inbox className="w-4 h-4 mr-2" />Dispatch
            {unassigned.data && unassigned.data.length > 0 && (
              <Badge variant="outline" className="ml-2 bg-warning/10 text-warning border-warning/30">{unassigned.data.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="active"><Truck className="w-4 h-4 mr-2" />Active deliveries</TabsTrigger>
        </TabsList>

        <TabsContent value="roster" className="mt-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base font-medium">Riders</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Quick actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(riders.data ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.phone || "—"}</TableCell>
                      <TableCell className="capitalize">{r.vehicle || "—"}</TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell className="text-right space-x-2">
                        {r.access_token && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const url = `${window.location.origin}/driver/${r.access_token}`;
                              navigator.clipboard.writeText(url);
                              toast.success("Driver link copied");
                            }}
                          >
                            <Link2 className="w-3.5 h-3.5 mr-1" /> Link
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: r.id, status: "available" })}>Available</Button>
                        <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: r.id, status: "offline" })}>Offline</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {riders.data && riders.data.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No riders yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dispatch" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base font-medium">Unassigned deliveries</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Paid delivery orders waiting for a rider. Auto-dispatch picks the nearest available rider.</p>
              </div>
              <Button onClick={dispatchAll} disabled={!unassigned.data?.length}>
                <Zap className="w-4 h-4 mr-1" /> Auto-dispatch all
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(unassigned.data ?? []).map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono">#{o.order_number}</TableCell>
                      <TableCell>
                        <div className="font-medium">{o.customer_name}</div>
                        <div className="text-xs text-muted-foreground">{o.customer_phone}</div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{o.channel}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[260px] truncate">
                        <MapPin className="w-3 h-3 inline mr-1" />
                        {o.delivery_address?.address || "—"}
                      </TableCell>
                      <TableCell>﷼{Number(o.total).toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => autoDispatch.mutate(o.id)} disabled={autoDispatch.isPending}>
                          <Zap className="w-3.5 h-3.5 mr-1" /> Auto-assign
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {unassigned.data && unassigned.data.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">All deliveries assigned.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="active" className="mt-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base font-medium">Active deliveries</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Rider</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Update</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(assignments.data ?? []).map((a) => {
                    const rider = (riders.data ?? []).find((r) => r.id === a.rider_id);
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono text-xs">#{String(a.order_id).slice(0, 8)}</TableCell>
                        <TableCell>{rider?.name ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <MapPin className="w-3 h-3 inline mr-1" />{a.delivery_address || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{a.status.replace("_", " ")}</Badge>
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          {a.status === "assigned" && (
                            <Button size="sm" variant="outline" onClick={() => updateAssignment.mutate({ id: a.id, status: "picked_up" })}>Picked up</Button>
                          )}
                          {(a.status === "assigned" || a.status === "picked_up") && (
                            <Button size="sm" onClick={() => updateAssignment.mutate({ id: a.id, status: "delivered" })}>
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Delivered
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {assignments.data && assignments.data.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No active deliveries.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}