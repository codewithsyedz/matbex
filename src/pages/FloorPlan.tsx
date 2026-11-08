import { useEffect, useMemo, useRef, useState } from "react";
import { useFloorPlans, useFloorTables, type FloorTable, type TableStatus } from "@/hooks/useFloorPlan";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Plus, Pencil, Eye, Trash2, LayoutGrid, Users, Clock, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";

const STATUS_COLORS: Record<TableStatus, { bg: string; ring: string; label: string }> = {
  free:    { bg: "bg-emerald-500/15",  ring: "ring-emerald-500/60",  label: "Free" },
  seated:  { bg: "bg-amber-500/20",    ring: "ring-amber-500/70",    label: "Seated" },
  ordered: { bg: "bg-sky-500/20",      ring: "ring-sky-500/70",      label: "Ordered" },
  billing: { bg: "bg-rose-500/20",     ring: "ring-rose-500/70",     label: "Billing" },
  dirty:   { bg: "bg-muted",           ring: "ring-muted-foreground/40", label: "Dirty" },
};

function randomCode() {
  return Math.random().toString(36).slice(2, 8).toLowerCase();
}

export default function FloorPlan() {
  const { isOwner, isManager } = useAuth();
  const canEdit = isOwner || isManager;
  const navigate = useNavigate();

  const { plans, isLoading: plansLoading, createPlan, deletePlan } = useFloorPlans();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedPlanId && plans.length > 0) {
      setSelectedPlanId(plans.find((p) => p.is_default)?.id ?? plans[0].id);
    }
  }, [plans, selectedPlanId]);

  const currentPlan = plans.find((p) => p.id === selectedPlanId) || null;
  const { tables, createTable, updateTable, setStatus, deleteTable } = useFloorTables(selectedPlanId);

  const [editMode, setEditMode] = useState(false);
  const [selectedTable, setSelectedTable] = useState<FloorTable | null>(null);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [newPlanName, setNewPlanName] = useState("");
  const [newTableOpen, setNewTableOpen] = useState(false);
  const [newTableForm, setNewTableForm] = useState({ label: "", capacity: 4, shape: "rect" as "rect" | "circle" });
  const [seatOpen, setSeatOpen] = useState(false);
  const [seatGuests, setSeatGuests] = useState(2);

  // KPIs
  const occupied = tables.filter((t) => t.status !== "free" && t.status !== "dirty").length;
  const occupancy = tables.length ? Math.round((occupied / tables.length) * 100) : 0;
  const seatedNow = tables.filter((t) => t.seated_at).length;

  // Drag in edit mode
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

  function onTablePointerDown(e: React.PointerEvent, t: FloorTable) {
    if (!editMode || !canEdit) return;
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    dragState.current = {
      id: t.id,
      offsetX: e.clientX - rect.left - t.x,
      offsetY: e.clientY - rect.top - t.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onTablePointerMove(e: React.PointerEvent, t: FloorTable) {
    if (!dragState.current || dragState.current.id !== t.id) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.round(e.clientX - rect.left - dragState.current.offsetX));
    const y = Math.max(0, Math.round(e.clientY - rect.top - dragState.current.offsetY));
    // Optimistic visual update via direct style; persist on pointer up
    const el = (e.currentTarget as HTMLElement);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    (el as any)._x = x;
    (el as any)._y = y;
  }

  function onTablePointerUp(e: React.PointerEvent, t: FloorTable) {
    if (!dragState.current || dragState.current.id !== t.id) return;
    const el = e.currentTarget as HTMLElement;
    const x = (el as any)._x ?? t.x;
    const y = (el as any)._y ?? t.y;
    dragState.current = null;
    if (x !== t.x || y !== t.y) updateTable.mutate({ id: t.id, x, y });
  }

  async function handleCreatePlan() {
    if (!newPlanName.trim()) return;
    try {
      const p = await createPlan.mutateAsync({ name: newPlanName.trim(), is_default: plans.length === 0 });
      setSelectedPlanId((p as any).id);
      setNewPlanOpen(false);
      setNewPlanName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create floor");
    }
  }

  async function handleCreateTable() {
    if (!newTableForm.label.trim() || !selectedPlanId) return;
    try {
      await createTable.mutateAsync({
        label: newTableForm.label.trim(),
        code: randomCode(),
        capacity: newTableForm.capacity,
        shape: newTableForm.shape,
        x: 60,
        y: 60,
        width: newTableForm.shape === "circle" ? 90 : 100,
        height: newTableForm.shape === "circle" ? 90 : 80,
      });
      toast.success("Table added");
      setNewTableOpen(false);
      setNewTableForm({ label: "", capacity: 4, shape: "rect" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add table");
    }
  }

  return (
    <div className="container mx-auto py-6 space-y-4 max-w-7xl">
      <div className="flex items-start justify-between gap-4 flex-wrap min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Floor Plan</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live view of every table. Tap a table to seat guests, mark billing, or clear.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {plans.length > 0 && (
            <Select value={selectedPlanId ?? ""} onValueChange={setSelectedPlanId}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select floor" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}{p.is_default ? " · default" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {canEdit && (
            <Dialog open={newPlanOpen} onOpenChange={setNewPlanOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm"><Plus className="h-4 w-4 mr-1" />Floor</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New floor</DialogTitle></DialogHeader>
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input placeholder="Main Dining" value={newPlanName} onChange={(e) => setNewPlanName(e.target.value)} />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setNewPlanOpen(false)}>Cancel</Button>
                  <Button onClick={handleCreatePlan} disabled={createPlan.isPending}>Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {canEdit && currentPlan && (
            <Button variant={editMode ? "default" : "outline"} size="sm" onClick={() => setEditMode((v) => !v)}>
              {editMode ? <Eye className="h-4 w-4 mr-1" /> : <Pencil className="h-4 w-4 mr-1" />}
              {editMode ? "View" : "Edit layout"}
            </Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      {currentPlan && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="Tables" value={tables.length} />
          <KpiCard label="Occupancy" value={`${occupancy}%`} />
          <KpiCard label="Seated now" value={seatedNow} />
          <KpiCard label="Free" value={tables.filter((t) => t.status === "free").length} />
        </div>
      )}

      {plansLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : plans.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <LayoutGrid className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium">No floor plan yet</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">Create your first floor to start placing tables.</p>
            {canEdit && <Button onClick={() => setNewPlanOpen(true)}><Plus className="h-4 w-4 mr-1" />New floor</Button>}
          </CardContent>
        </Card>
      ) : currentPlan && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
            <div className="flex items-center gap-3 text-xs">
              {(Object.keys(STATUS_COLORS) as TableStatus[]).map((s) => (
                <div key={s} className="flex items-center gap-1.5">
                  <span className={`inline-block h-2.5 w-2.5 rounded-sm ${STATUS_COLORS[s].bg} ring-1 ${STATUS_COLORS[s].ring}`} />
                  <span className="text-muted-foreground">{STATUS_COLORS[s].label}</span>
                </div>
              ))}
            </div>
            {editMode && canEdit && (
              <Dialog open={newTableOpen} onOpenChange={setNewTableOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline"><Plus className="h-3 w-3 mr-1" />Table</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add table</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>Label</Label>
                      <Input value={newTableForm.label} onChange={(e) => setNewTableForm((f) => ({ ...f, label: e.target.value }))} placeholder="T1" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Seats</Label>
                        <Input type="number" min={1} value={newTableForm.capacity} onChange={(e) => setNewTableForm((f) => ({ ...f, capacity: Number(e.target.value) }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Shape</Label>
                        <Select value={newTableForm.shape} onValueChange={(v) => setNewTableForm((f) => ({ ...f, shape: v as "rect" | "circle" }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="rect">Rectangle</SelectItem>
                            <SelectItem value="circle">Circle</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setNewTableOpen(false)}>Cancel</Button>
                    <Button onClick={handleCreateTable} disabled={createTable.isPending}>Add</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
          <div className="relative bg-[radial-gradient(circle,hsl(var(--muted))_1px,transparent_1px)] bg-[size:24px_24px] overflow-auto">
            <div
              ref={canvasRef}
              className="relative"
              style={{ width: currentPlan.width, height: currentPlan.height }}
            >
              {tables.map((t) => {
                const c = STATUS_COLORS[t.status];
                return (
                  <div
                    key={t.id}
                    onPointerDown={(e) => onTablePointerDown(e, t)}
                    onPointerMove={(e) => onTablePointerMove(e, t)}
                    onPointerUp={(e) => onTablePointerUp(e, t)}
                    onClick={() => !editMode && setSelectedTable(t)}
                    className={`absolute flex flex-col items-center justify-center select-none transition-colors ${c.bg} ring-2 ${c.ring} ${editMode ? "cursor-move" : "cursor-pointer hover:brightness-110"} ${t.shape === "circle" ? "rounded-full" : "rounded-md"}`}
                    style={{ left: t.x, top: t.y, width: t.width, height: t.height }}
                  >
                    <div className="text-sm font-medium leading-none">{t.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-0.5">
                      <Users className="h-2.5 w-2.5" />{t.guest_count ?? t.capacity}
                    </div>
                    {t.seated_at && !editMode && (
                      <div className="text-[9px] text-muted-foreground mt-0.5 flex items-center gap-0.5">
                        <Clock className="h-2 w-2" />
                        {formatDistanceToNow(new Date(t.seated_at))}
                      </div>
                    )}
                  </div>
                );
              })}
              {tables.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  {editMode ? "Click \"Table\" to add your first table." : "No tables on this floor yet."}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Detail sheet */}
      <Sheet open={!!selectedTable} onOpenChange={(v) => !v && setSelectedTable(null)}>
        <SheetContent>
          {selectedTable && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {selectedTable.label}
                  <Badge variant="outline">{STATUS_COLORS[selectedTable.status].label}</Badge>
                </SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Seats</div>
                    <div>{selectedTable.capacity}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Guests</div>
                    <div>{selectedTable.guest_count ?? "—"}</div>
                  </div>
                  {selectedTable.seated_at && (
                    <div className="col-span-2">
                      <div className="text-xs text-muted-foreground">Seated</div>
                      <div>{formatDistanceToNow(new Date(selectedTable.seated_at), { addSuffix: true })}</div>
                    </div>
                  )}
                </div>

                <div className="space-y-2 pt-2 border-t">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Actions</p>
                  {selectedTable.status === "free" && (
                    <Button className="w-full" onClick={() => setSeatOpen(true)}>Seat guests</Button>
                  )}
                  {(selectedTable.status === "free" || selectedTable.status === "seated" || selectedTable.status === "ordered") && (
                    <Button
                      className="w-full"
                      variant={selectedTable.status === "ordered" ? "outline" : "default"}
                      onClick={() => {
                        const id = selectedTable.id;
                        if (selectedTable.status === "free") {
                          setStatus.mutate({ id, status: "seated", guest_count: selectedTable.capacity });
                        }
                        setSelectedTable(null);
                        navigate(`/record-sale?table=${id}`);
                      }}
                    >
                      <ShoppingCart className="h-4 w-4 mr-1" />
                      {selectedTable.status === "ordered" ? "Add to order" : "Start order"}
                    </Button>
                  )}
                  {(selectedTable.status === "seated" || selectedTable.status === "ordered") && (
                    <Button className="w-full" variant="outline" onClick={() => {
                      setStatus.mutate({ id: selectedTable.id, status: "billing" });
                      setSelectedTable(null);
                    }}>Mark billing</Button>
                  )}
                  {selectedTable.status === "billing" && (
                    <Button className="w-full" variant="outline" onClick={() => {
                      setStatus.mutate({ id: selectedTable.id, status: "dirty" });
                      setSelectedTable(null);
                    }}>Mark cleared</Button>
                  )}
                  {selectedTable.status !== "free" && (
                    <Button className="w-full" variant="ghost" onClick={() => {
                      setStatus.mutate({ id: selectedTable.id, status: "free" });
                      setSelectedTable(null);
                    }}>Reset to free</Button>
                  )}
                  {canEdit && (
                    <Button className="w-full" variant="ghost" onClick={() => {
                      if (confirm(`Delete ${selectedTable.label}?`)) {
                        deleteTable.mutate(selectedTable.id);
                        setSelectedTable(null);
                      }
                    }}>
                      <Trash2 className="h-4 w-4 mr-1" />Delete table
                    </Button>
                  )}
                </div>
              </div>

              {/* Seat dialog */}
              <Dialog open={seatOpen} onOpenChange={setSeatOpen}>
                <DialogContent>
                  <DialogHeader><DialogTitle>Seat guests at {selectedTable.label}</DialogTitle></DialogHeader>
                  <div className="space-y-2">
                    <Label>Guest count</Label>
                    <Input type="number" min={1} max={selectedTable.capacity * 2} value={seatGuests} onChange={(e) => setSeatGuests(Number(e.target.value))} />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setSeatOpen(false)}>Cancel</Button>
                    <Button onClick={() => {
                      setStatus.mutate({ id: selectedTable.id, status: "seated", guest_count: seatGuests });
                      setSeatOpen(false);
                      setSelectedTable(null);
                    }}>Seat</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className="text-2xl font-light mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}