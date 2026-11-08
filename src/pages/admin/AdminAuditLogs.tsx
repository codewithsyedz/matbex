import { useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";
import { Search, Shield, User, Building2, Settings2, Users } from "lucide-react";
import { format } from "date-fns";

interface AuditLog {
  id: string;
  user_id: string | null;
  tenant_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
  user_profile?: { full_name: string | null } | null;
  tenant?: { name: string } | null;
}

const ENTITY_ICONS: Record<string, React.ElementType> = {
  tenants: Building2,
  superadmin_users: Shield,
  user_tenant_roles: Users,
  plans: Settings2,
  restaurants: Building2,
};

export default function AdminAuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");

  const fetchLogs = async () => {
    try {
      const { data: logsData, error } = await db
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;

      // Fetch user profiles and tenant names
      const userIds = [...new Set((logsData || []).map(l => l.user_id).filter(Boolean))];
      const tenantIds = [...new Set((logsData || []).map(l => l.tenant_id).filter(Boolean))];

      const [{ data: profiles }, { data: tenants }] = await Promise.all([
        userIds.length > 0
          ? db.from("profiles").select("id, full_name").in("id", userIds)
          : { data: [] },
        tenantIds.length > 0
          ? db.from("tenants").select("id, name").in("id", tenantIds)
          : { data: [] },
      ]);

      const enrichedLogs = (logsData || []).map(log => ({
        ...log,
        old_data: log.old_data as Record<string, unknown> | null,
        new_data: log.new_data as Record<string, unknown> | null,
        user_profile: profiles?.find(p => p.id === log.user_id),
        tenant: tenants?.find(t => t.id === log.tenant_id),
      }));

      setLogs(enrichedLogs);
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      toast.error("Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const getActionBadge = (action: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      INSERT: "default",
      UPDATE: "secondary",
      DELETE: "destructive",
    };
    return <Badge variant={variants[action] || "outline"}>{action}</Badge>;
  };

  const getEntityIcon = (entityType: string) => {
    const Icon = ENTITY_ICONS[entityType] || Settings2;
    return <Icon className="h-4 w-4 text-muted-foreground" />;
  };

  const formatChanges = (oldData: Record<string, unknown> | null, newData: Record<string, unknown> | null) => {
    if (!oldData && !newData) return "-";
    
    if (!oldData && newData) {
      // Insert - show key fields
      const keys = Object.keys(newData).filter(k => !['id', 'created_at', 'updated_at'].includes(k));
      return keys.slice(0, 3).map(k => `${k}: ${String(newData[k]).slice(0, 20)}`).join(", ");
    }
    
    if (oldData && newData) {
      // Update - show changed fields
      const changes: string[] = [];
      for (const key of Object.keys(newData)) {
        if (JSON.stringify(oldData[key]) !== JSON.stringify(newData[key])) {
          changes.push(`${key}: ${String(oldData[key]).slice(0, 10)} → ${String(newData[key]).slice(0, 10)}`);
        }
      }
      return changes.slice(0, 2).join(", ") || "No visible changes";
    }
    
    if (oldData && !newData) {
      return "Record deleted";
    }
    
    return "-";
  };

  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      log.entity_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.user_profile?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.tenant?.name?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesEntity = entityFilter === "all" || log.entity_type === entityFilter;
    const matchesAction = actionFilter === "all" || log.action === actionFilter;
    
    return matchesSearch && matchesEntity && matchesAction;
  });

  const uniqueEntities = [...new Set(logs.map(l => l.entity_type))];
  const uniqueActions = [...new Set(logs.map(l => l.action))];

  return (
    <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Audit Logs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track all administrative actions and data changes across the platform.
          </p>
        </div>

        <Card className="border-border/40">
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <CardTitle className="text-lg font-medium">Activity Log</CardTitle>
                <CardDescription>{filteredLogs.length} of {logs.length} entries</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 w-48"
                  />
                </div>
                <Select value={entityFilter} onValueChange={setEntityFilter}>
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="Entity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Entities</SelectItem>
                    {uniqueEntities.map(entity => (
                      <SelectItem key={entity} value={entity}>{entity}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={actionFilter} onValueChange={setActionFilter}>
                  <SelectTrigger className="w-28">
                    <SelectValue placeholder="Action" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {uniqueActions.map(action => (
                      <SelectItem key={action} value={action}>{action}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border/40">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Changes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        Loading audit logs...
                      </TableCell>
                    </TableRow>
                  ) : filteredLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No audit logs found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                          {format(new Date(log.created_at), "MMM d, HH:mm:ss")}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
                              <User className="h-3 w-3 text-muted-foreground" />
                            </div>
                            <span className="text-sm">
                              {log.user_profile?.full_name || "System"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>{getActionBadge(log.action)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getEntityIcon(log.entity_type)}
                            <span className="text-sm">{log.entity_type}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {log.tenant?.name || "-"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs max-w-48 truncate">
                          {formatChanges(log.old_data, log.new_data)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
  );
}
