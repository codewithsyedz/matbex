import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Loader2, Coins, Star } from "lucide-react";

interface PlatformCurrency {
  code: string;
  name: string;
  symbol: string;
  enabled: boolean;
  sort_order: number;
  is_default: boolean;
}

const empty: PlatformCurrency = {
  code: "",
  name: "",
  symbol: "",
  enabled: true,
  sort_order: 100,
  is_default: false,
};

export default function AdminCurrencies() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PlatformCurrency | null>(null);
  const [form, setForm] = useState<PlatformCurrency>(empty);

  const { data: currencies, isLoading } = useQuery({
    queryKey: ["platform-currencies", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_currencies" as any)
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data as any) as PlatformCurrency[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["platform-currencies"] });
  };

  const upsertMutation = useMutation({
    mutationFn: async (c: PlatformCurrency) => {
      const payload = { ...c, code: c.code.toUpperCase().trim() };
      if (editing) {
        const { error } = await supabase
          .from("platform_currencies" as any)
          .update(payload)
          .eq("code", editing.code);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("platform_currencies" as any)
          .insert(payload);
        if (error) throw error;
      }
      // If marking as default, unset other defaults
      if (payload.is_default) {
        await supabase
          .from("platform_currencies" as any)
          .update({ is_default: false })
          .neq("code", payload.code);
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Currency updated" : "Currency added");
      setDialogOpen(false);
      setEditing(null);
      setForm(empty);
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save"),
  });

  const toggleEnabled = useMutation({
    mutationFn: async (c: PlatformCurrency) => {
      const { error } = await supabase
        .from("platform_currencies" as any)
        .update({ enabled: !c.enabled })
        .eq("code", c.code);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (code: string) => {
      const { error } = await supabase
        .from("platform_currencies" as any)
        .delete()
        .eq("code", code);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Currency removed");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openNew = () => {
    setEditing(null);
    setForm(empty);
    setDialogOpen(true);
  };

  const openEdit = (c: PlatformCurrency) => {
    setEditing(c);
    setForm(c);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Currencies
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage which currencies tenants can choose across the platform.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" /> Add currency
        </Button>
      </div>

      <Card className="border-border/40">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Coins className="h-4 w-4" />
            Configured currencies
          </CardTitle>
          <CardDescription>
            Disabled currencies are hidden from tenant currency pickers. The default is
            auto-applied to new restaurants.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !currencies || currencies.length === 0 ? (
            <div className="text-center p-8 text-muted-foreground text-sm">
              No currencies configured yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currencies.map((c) => (
                  <TableRow key={c.code}>
                    <TableCell className="font-mono font-medium">{c.code}</TableCell>
                    <TableCell>{c.name}</TableCell>
                    <TableCell className="text-lg">{c.symbol}</TableCell>
                    <TableCell>{c.sort_order}</TableCell>
                    <TableCell>
                      {c.is_default && (
                        <Badge variant="secondary" className="gap-1">
                          <Star className="h-3 w-3" /> Default
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={c.enabled}
                        onCheckedChange={() => toggleEnabled.mutate(c)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (
                            confirm(
                              `Delete ${c.code}? Tenants currently using this currency will need to pick another.`
                            )
                          ) {
                            deleteMutation.mutate(c.code);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.code}` : "Add currency"}
            </DialogTitle>
            <DialogDescription>
              ISO 4217 code, display name, and a short symbol.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Code</Label>
                <Input
                  value={form.code}
                  disabled={!!editing}
                  maxLength={6}
                  placeholder="USD"
                  onChange={(e) =>
                    setForm({ ...form, code: e.target.value.toUpperCase() })
                  }
                />
              </div>
              <div>
                <Label>Symbol</Label>
                <Input
                  value={form.symbol}
                  placeholder="$"
                  onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                placeholder="US Dollar"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Sort order</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) =>
                    setForm({ ...form, sort_order: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="flex items-end gap-6">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.enabled}
                    onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                  />
                  <Label>Enabled</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.is_default}
                    onCheckedChange={(v) => setForm({ ...form, is_default: v })}
                  />
                  <Label>Default</Label>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => upsertMutation.mutate(form)}
              disabled={
                upsertMutation.isPending ||
                !form.code ||
                !form.name ||
                !form.symbol
              }
            >
              {upsertMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}