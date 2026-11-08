import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, Palette, Pencil, Search, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  BranchBadge,
  branchColorways,
  branchColorwayIndex,
} from "@/components/branch/BranchBadge";
import { cn } from "@/lib/utils";

interface BranchRow {
  id: string;
  name: string;
  code: string | null;
  city: string | null;
  country: string | null;
  is_primary: boolean;
  is_active: boolean;
}

export default function BranchSettings() {
  const { restaurant, hasRole } = useAuth();
  const qc = useQueryClient();
  const restaurantId = restaurant?.id ?? null;
  const canEdit = hasRole("owner") || hasRole("manager");

  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftCode, setDraftCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewName, setPreviewName] = useState("");

  const { data: branches = [], isLoading } = useQuery({
    queryKey: ["branches", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches" as any)
        .select("id,name,code,city,country,is_primary,is_active")
        .eq("restaurant_id", restaurantId!)
        .is("deleted_at", null)
        .order("is_primary", { ascending: false })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as BranchRow[];
    },
  });

  useEffect(() => {
    if (!previewName && branches.length > 0) setPreviewName(branches[0].name);
  }, [branches, previewName]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        (b.code ?? "").toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q),
    );
  }, [branches, search]);

  const startEdit = (b: BranchRow) => {
    setEditingId(b.id);
    setDraftName(b.name);
    setDraftCode(b.code ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftName("");
    setDraftCode("");
  };

  const saveEdit = async (b: BranchRow) => {
    const name = draftName.trim();
    if (!name) {
      toast.error("Branch name is required");
      return;
    }
    const code = draftCode.trim().toUpperCase();
    const duplicate = branches.some(
      (other) => other.id !== b.id && code && (other.code ?? "").toUpperCase() === code,
    );
    if (duplicate) {
      toast.error("That branch code is already mapped to another branch");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("branches" as any)
        .update({ name, code: code || null })
        .eq("id", b.id);
      if (error) throw error;
      toast.success("Branch updated");
      qc.invalidateQueries({ queryKey: ["branches"] });
      cancelEdit();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update branch");
    } finally {
      setSaving(false);
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/settings" aria-label="Back to settings">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Branch settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Rename branches, map branch IDs and codes, and preview badge colors.
          </p>
        </div>
      </div>

      <Tabs defaultValue="branches">
        <TabsList>
          <TabsTrigger value="branches">Branches</TabsTrigger>
          <TabsTrigger value="mapping">ID mapping</TabsTrigger>
          <TabsTrigger value="badges">Badge preview</TabsTrigger>
        </TabsList>

        <TabsContent value="branches" className="mt-4">
          <Card>
            <CardHeader className="gap-3 pb-3">
              <div>
                <CardTitle className="text-base font-medium">Rename branches</CardTitle>
                <CardDescription>
                  Names and codes update everywhere branches appear, including badges and reports.
                </CardDescription>
              </div>
              <div className="relative max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search name, code or ID"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Badge</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        Loading branches…
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        No branches found.
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.map((b) => {
                    const isEditing = editingId === b.id;
                    return (
                      <TableRow key={b.id}>
                        <TableCell>
                          <BranchBadge name={isEditing ? draftName || b.name : b.name} branchId={b.id} />
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input
                              value={draftName}
                              onChange={(e) => setDraftName(e.target.value)}
                              className="h-8 max-w-[220px]"
                            />
                          ) : (
                            <span className="font-medium">{b.name}</span>
                          )}
                          <div className="text-xs text-muted-foreground">
                            {[b.city, b.country].filter(Boolean).join(", ") || "—"}
                          </div>
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input
                              value={draftCode}
                              onChange={(e) => setDraftCode(e.target.value)}
                              placeholder="e.g. HQ"
                              className="h-8 max-w-[120px]"
                            />
                          ) : (
                            <span className="font-mono text-xs">{b.code || "—"}</span>
                          )}
                        </TableCell>
                        <TableCell className="space-x-1">
                          {b.is_primary && <Badge variant="secondary">Primary</Badge>}
                          <Badge variant={b.is_active ? "outline" : "destructive"}>
                            {b.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {isEditing ? (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" onClick={() => saveEdit(b)} disabled={saving}>
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => startEdit(b)}
                              disabled={!canEdit}
                            >
                              <Pencil className="mr-1.5 h-3.5 w-3.5" />
                              Rename
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {!canEdit && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Only owners and managers can rename branches.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mapping" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Branch ID mapping</CardTitle>
              <CardDescription>
                Use these IDs when mapping branches to POS terminals, imports or external systems.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Branch</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Branch ID</TableHead>
                    <TableHead className="text-right">Copy</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branches.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <BranchBadge name={b.name} branchId={b.id} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{b.code || "—"}</TableCell>
                      <TableCell className="font-mono text-xs break-all">{b.id}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => copy(b.id, "Branch ID")}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="badges" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Palette className="h-4 w-4" /> Badge colors in use
              </CardTitle>
              <CardDescription>
                Colors are derived automatically from the branch name, so renaming a branch can change
                its badge color.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                {branches.map((b) => (
                  <div key={b.id} className="flex items-center gap-2 rounded-lg border p-2">
                    <BranchBadge name={b.name} branchId={b.id} compact />
                    <BranchBadge name={b.name} branchId={b.id} />
                    <span className="text-[10px] text-muted-foreground">
                      #{branchColorwayIndex(b.name) + 1}
                    </span>
                  </div>
                ))}
                <div className="flex items-center gap-2 rounded-lg border p-2">
                  <BranchBadge name={null} />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Preview a name</p>
                <Input
                  value={previewName}
                  onChange={(e) => setPreviewName(e.target.value)}
                  placeholder="Type a branch name…"
                  className="max-w-sm"
                />
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <BranchBadge name={previewName} size="sm" />
                  <BranchBadge name={previewName} />
                  <BranchBadge name={previewName} compact />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Palette</p>
                <div className="flex flex-wrap gap-2">
                  {branchColorways.map((cw, i) => (
                    <span
                      key={i}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-normal",
                        cw,
                      )}
                    >
                      Colorway {i + 1}
                    </span>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}