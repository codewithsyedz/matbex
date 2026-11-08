import { useEffect, useMemo, useState } from "react";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Globe, MoreHorizontal, Pencil, PauseCircle, PlayCircle, Trash2, ExternalLink, Search,
} from "lucide-react";
import { format } from "date-fns";

interface SubdomainRow {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_status: string;
  plan_name: string | null;
  subdomain: string | null;
  custom_domain: string | null;
  domain_status: string;
  ssl_status: string | null;
  created_at: string;
  updated_at: string;
}

type ActionKind = "suspend" | "unsuspend" | "rename" | "release";

const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" => {
  if (s === "active") return "default";
  if (s === "offline") return "destructive";
  if (s === "failed") return "destructive";
  return "secondary";
};

export default function AdminSubdomains() {
  const [rows, setRows] = useState<SubdomainRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  // dialog state
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<SubdomainRow | null>(null);
  const [action, setAction] = useState<ActionKind>("suspend");
  const [newSlug, setNewSlug] = useState("");
  const [reason, setReason] = useState("");

  const fetchRows = async () => {
    setLoading(true);
    const { data, error } = await db.rpc("admin_list_subdomains");
    if (error) {
      console.error(error);
      toast.error("Failed to load subdomains");
      setRows([]);
    } else {
      setRows((data as SubdomainRow[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchRows(); }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(r =>
      (r.subdomain || "").toLowerCase().includes(needle) ||
      r.tenant_name.toLowerCase().includes(needle) ||
      (r.custom_domain || "").toLowerCase().includes(needle)
    );
  }, [rows, q]);

  const openAction = (row: SubdomainRow, kind: ActionKind) => {
    setTarget(row);
    setAction(kind);
    setNewSlug(row.subdomain || "");
    setReason("");
    setOpen(true);
  };

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    try {
      if (action === "suspend") {
        const { error } = await db.rpc("admin_suspend_subdomain", {
          _tenant_id: target.tenant_id, _reason: reason || null,
        });
        if (error) throw error;
        toast.success("Subdomain suspended");
      } else if (action === "unsuspend") {
        const { error } = await db.rpc("admin_unsuspend_subdomain", {
          _tenant_id: target.tenant_id,
        });
        if (error) throw error;
        toast.success("Subdomain reactivated");
      } else if (action === "rename") {
        const clean = newSlug.trim().toLowerCase();
        if (!clean) { toast.error("Enter a new subdomain"); setBusy(false); return; }
        const { data, error } = await db.rpc("admin_force_rename_subdomain", {
          _tenant_id: target.tenant_id, _new_subdomain: clean, _reason: reason || null,
        });
        if (error) throw error;
        toast.success(`Renamed to ${data}.matbex.com (90-day redirect kept)`);
      } else if (action === "release") {
        const { error } = await db.rpc("admin_release_subdomain", {
          _tenant_id: target.tenant_id, _reason: reason || null,
        });
        if (error) throw error;
        toast.success("Subdomain released");
      }
      setOpen(false);
      setTarget(null);
      fetchRows();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          Subdomain Governance
        </h1>
        <p className="text-sm text-muted-foreground mt-1 font-light">
          Suspend, force-rename, or release tenant subdomains across <span className="font-medium">*.matbex.com</span>.
        </p>
      </div>

      <Card className="border-border/40">
        <CardHeader className="flex flex-row items-end justify-between gap-4">
          <div>
            <CardTitle className="text-lg font-medium">All tenant subdomains</CardTitle>
            <CardDescription>{rows.length} total · {rows.filter(r => r.domain_status === "active").length} active</CardDescription>
          </div>
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search slug, tenant, custom domain…"
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No subdomains found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subdomain</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Custom domain</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">
                      {r.subdomain ? (
                        <a
                          href={`https://${r.subdomain}.matbex.com`}
                          target="_blank" rel="noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                          {r.subdomain}.matbex.com
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">— released —</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{r.tenant_name}</span>
                        <span className="text-xs text-muted-foreground">{r.tenant_status}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.plan_name || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(r.domain_status)}>{r.domain_status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.custom_domain || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(r.updated_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openAction(r, "rename")}>
                            <Pencil className="h-4 w-4 mr-2" /> Force rename
                          </DropdownMenuItem>
                          {r.domain_status === "offline" ? (
                            <DropdownMenuItem onClick={() => openAction(r, "unsuspend")}>
                              <PlayCircle className="h-4 w-4 mr-2" /> Reactivate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => openAction(r, "suspend")}>
                              <PauseCircle className="h-4 w-4 mr-2" /> Suspend
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => openAction(r, "release")}
                            disabled={!r.subdomain}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Release slug
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === "suspend" && "Suspend subdomain"}
              {action === "unsuspend" && "Reactivate subdomain"}
              {action === "rename" && "Force-rename subdomain"}
              {action === "release" && "Release subdomain"}
            </DialogTitle>
            <DialogDescription>
              {target && (
                <>Tenant: <span className="font-medium">{target.tenant_name}</span>
                {target.subdomain && <> · current: <span className="font-mono">{target.subdomain}.matbex.com</span></>}</>
              )}
            </DialogDescription>
          </DialogHeader>

          {action === "rename" && (
            <div className="space-y-2">
              <Label>New subdomain</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value)}
                  placeholder="acme-bistro"
                  className="font-mono"
                />
                <span className="text-sm text-muted-foreground">.matbex.com</span>
              </div>
              <p className="text-xs text-muted-foreground">
                The old slug will keep redirecting for 90 days.
              </p>
            </div>
          )}

          {action !== "unsuspend" && (
            <div className="space-y-2">
              <Label>Reason (recorded in audit log)</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  action === "suspend" ? "Trademark complaint, abuse report, payment failure…" :
                  action === "release" ? "Customer churned, slug squatting…" :
                  "Brand change, typo, dispute resolution…"
                }
                rows={3}
              />
            </div>
          )}

          {action === "release" && (
            <p className="text-sm text-destructive">
              This frees <span className="font-mono">{target?.subdomain}</span> for re-use by anyone. The tenant's landing page will go offline.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button
              onClick={submit}
              disabled={busy}
              variant={action === "release" || action === "suspend" ? "destructive" : "default"}
            >
              {busy ? "Working…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}