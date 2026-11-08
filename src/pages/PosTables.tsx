import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { usePosTables, usePosTableOrders, type PosTable } from "@/hooks/usePosTables";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Printer, QrCode } from "lucide-react";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/useCurrency";
import { formatDistanceToNow } from "date-fns";

function randomCode(): string {
  return Math.random().toString(36).slice(2, 8).toLowerCase();
}

function tableUrl(code: string): string {
  return `${window.location.origin}/t/${code}`;
}

export default function PosTables() {
  const { tables, isLoading, createTable, updateTable, deleteTable } = usePosTables();
  const { data: orders } = usePosTableOrders();
  const { format } = useCurrency();
  const [createOpen, setCreateOpen] = useState(false);
  const [qrTable, setQrTable] = useState<PosTable | null>(null);
  const [form, setForm] = useState({ label: "", code: randomCode(), capacity: 4 });

  const openOrdersByTable = useMemo(() => {
    const map = new Map<string, number>();
    (orders || []).forEach((o) => {
      if (o.status === "submitted" || o.status === "accepted") {
        map.set(o.table_id, (map.get(o.table_id) || 0) + 1);
      }
    });
    return map;
  }, [orders]);

  async function handleCreate() {
    if (!form.label.trim()) {
      toast.error("Label is required");
      return;
    }
    try {
      await createTable.mutateAsync({
        label: form.label.trim(),
        code: form.code.trim() || randomCode(),
        capacity: form.capacity || 4,
      });
      toast.success("Table created");
      setCreateOpen(false);
      setForm({ label: "", code: randomCode(), capacity: 4 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create table");
    }
  }

  function printQR(table: PosTable) {
    const url = tableUrl(table.code);
    const win = window.open("", "_blank");
    if (!win) return;
    const svg = document.getElementById(`qr-print-${table.id}`)?.outerHTML || "";
    win.document.write(`
      <html><head><title>${table.label} — QR</title>
      <style>body{font-family:system-ui;padding:40px;text-align:center}h1{font-weight:300;margin:0 0 8px}p{color:#666;margin:4px 0}.card{display:inline-block;padding:32px;border:1px solid #ddd;border-radius:12px}</style>
      </head><body>
      <div class="card">
        <h1>${table.label}</h1>
        <p>Scan to view menu &amp; order</p>
        <div style="margin:24px 0">${svg}</div>
        <p style="font-size:11px;color:#999">${url}</p>
      </div>
      </body></html>`);
    win.document.close();
    win.print();
  }

  return (
    <div className="container mx-auto py-6 space-y-6 max-w-6xl">
      <div className="flex items-start justify-between min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">QR Pay-at-Table</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate QR codes for each table. Guests scan, browse the menu, and submit orders directly.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New table
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add a table</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Label</Label>
                <Input
                  placeholder="Table 5"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>QR code slug</Label>
                  <Input
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  />
                  <p className="text-[11px] text-muted-foreground">Short URL: /t/{form.code || "..."}</p>
                </div>
                <div className="space-y-2">
                  <Label>Capacity</Label>
                  <Input
                    type="number"
                    min={1}
                    value={form.capacity}
                    onChange={(e) => setForm((f) => ({ ...f, capacity: Number(e.target.value) }))}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createTable.isPending}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="tables">
        <TabsList>
          <TabsTrigger value="tables">Tables ({tables.length})</TabsTrigger>
          <TabsTrigger value="orders">
            Live orders
            {(orders || []).filter((o) => o.status === "submitted").length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {(orders || []).filter((o) => o.status === "submitted").length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tables" className="mt-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tables.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center">
                <QrCode className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm font-medium">No tables yet</p>
                <p className="text-xs text-muted-foreground mt-1">Create your first table to generate a QR code.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tables.map((t) => {
                const openCount = openOrdersByTable.get(t.id) || 0;
                return (
                  <Card key={t.id} className="overflow-hidden">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base font-medium">{t.label}</CardTitle>
                          <CardDescription className="text-xs mt-0.5">
                            /t/{t.code} · seats {t.capacity}
                          </CardDescription>
                        </div>
                        {openCount > 0 && (
                          <Badge variant="default">{openCount} open</Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="bg-muted/30 rounded-md p-3 flex justify-center">
                        <div id={`qr-print-${t.id}`}>
                          <QRCodeSVG value={tableUrl(t.code)} size={120} level="M" />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={t.is_active}
                            onCheckedChange={(v) => updateTable.mutate({ id: t.id, is_active: v })}
                          />
                          <span className="text-xs text-muted-foreground">{t.is_active ? "Active" : "Disabled"}</span>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => setQrTable(t)}>
                            <QrCode className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => printQR(t)}>
                            <Printer className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (confirm(`Delete ${t.label}?`)) deleteTable.mutate(t.id);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="orders" className="mt-6">
          {!orders || orders.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                No orders yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {orders.map((o) => {
                const table = tables.find((t) => t.id === o.table_id);
                return (
                  <Card key={o.id}>
                    <CardContent className="pt-6 flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium text-sm">{table?.label || "Table"}</p>
                          <Badge
                            variant={
                              o.status === "paid"
                                ? "secondary"
                                : o.status === "cancelled"
                                ? "outline"
                                : "default"
                            }
                            className="text-[10px]"
                          >
                            {o.status}
                          </Badge>
                          {o.guest_name && (
                            <span className="text-xs text-muted-foreground">· {o.guest_name}</span>
                          )}
                          <span className="text-xs text-muted-foreground ml-auto">
                            {formatDistanceToNow(new Date(o.submitted_at), { addSuffix: true })}
                          </span>
                        </div>
                        <ul className="text-xs text-muted-foreground space-y-0.5">
                          {(o.items || []).map((it, i) => (
                            <li key={i}>
                              {it.qty}× {it.name}
                              {it.size && it.size !== "full" ? ` (${it.size})` : ""}
                            </li>
                          ))}
                        </ul>
                        {o.notes && <p className="text-xs italic text-muted-foreground mt-1">"{o.notes}"</p>}
                      </div>
                      <div className="text-right space-y-2">
                        <p className="font-medium">{format(Number(o.total))}</p>
                        {o.status === "submitted" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              const { error } = await import("@/integrations/supabase/client").then(({ supabase }) =>
                                supabase
                                  .from("pos_table_orders")
                                  .update({ status: "paid", paid_at: new Date().toISOString() })
                                  .eq("id", o.id)
                              );
                              if (error) toast.error(error.message);
                              else toast.success("Marked paid");
                            }}
                          >
                            Mark paid
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!qrTable} onOpenChange={(v) => !v && setQrTable(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{qrTable?.label}</DialogTitle>
          </DialogHeader>
          {qrTable && (
            <div className="flex flex-col items-center gap-3 py-4">
              <QRCodeSVG value={tableUrl(qrTable.code)} size={240} level="M" />
              <p className="text-xs text-muted-foreground break-all text-center">{tableUrl(qrTable.code)}</p>
              <Button variant="outline" size="sm" onClick={() => qrTable && printQR(qrTable)}>
                <Printer className="h-4 w-4 mr-2" /> Print
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}