import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Clock,
  Search,
  Filter,
  User,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Eye,
  AlertTriangle,
  Edit,
  Trash2,
  Plus,
  Download,
  FileText,
  FileSpreadsheet,
} from "lucide-react";
import { format } from "date-fns";
import { exportToCSV, exportToPDF } from "@/lib/exportUtils";

// Critical actions that trigger real-time notifications
const CRITICAL_ACTIONS = ["SHIFT_TIMESTAMP_OVERRIDE", "DELETE"];

interface AuditLog {
  id: string;
  user_id: string | null;
  tenant_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_data: any;
  new_data: any;
  created_at: string;
  user_email?: string;
}

const actionConfig: Record<string, { label: string; className: string; icon: any }> = {
  INSERT: { label: "Created", className: "bg-success/10 text-success", icon: Plus },
  UPDATE: { label: "Updated", className: "bg-primary/10 text-primary", icon: Edit },
  DELETE: { label: "Deleted", className: "bg-destructive/10 text-destructive", icon: Trash2 },
  SHIFT_TIMESTAMP_OVERRIDE: { label: "Timestamp Override", className: "bg-warning/10 text-warning", icon: AlertTriangle },
};

export default function AuditLogs() {
  const { restaurant, hasRole, isOwner, profile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [allLogsForExport, setAllLogsForExport] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const pageSize = 25;

  // Redirect non-owners
  useEffect(() => {
    if (!isOwner && hasRole) {
      navigate("/dashboard");
    }
  }, [isOwner, hasRole, navigate]);

  const fetchLogs = async () => {
    if (!restaurant?.tenant_id) return;

    setIsLoading(true);
    try {
      let query = supabase
        .from("audit_logs")
        .select("*")
        .eq("tenant_id", restaurant.tenant_id)
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (actionFilter !== "all") {
        query = query.eq("action", actionFilter);
      }

      if (entityFilter !== "all") {
        query = query.eq("entity_type", entityFilter);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Fetch user emails for the logs
      const userIds = [...new Set(data?.filter(l => l.user_id).map(l => l.user_id))] as string[];
      let userMap = new Map<string, string>();
      
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        
        userMap = new Map(profiles?.map(p => [p.id, p.full_name || "Unknown"]) || []);
      }

      const enrichedLogs = (data || []).map(log => ({
        ...log,
        user_email: log.user_id ? userMap.get(log.user_id) || "Unknown" : "System",
      }));

      setLogs(enrichedLogs);
      setHasMore((data?.length || 0) === pageSize);
    } catch (error) {
      console.error("Error fetching audit logs:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (restaurant?.tenant_id && isOwner) {
      fetchLogs();
    }
  }, [restaurant?.tenant_id, isOwner, page, actionFilter, entityFilter]);

  // Real-time subscription for critical audit events
  useEffect(() => {
    if (!restaurant?.tenant_id || !isOwner) return;

    const channel = supabase
      .channel("audit-logs-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "audit_logs",
          filter: `tenant_id=eq.${restaurant.tenant_id}`,
        },
        async (payload) => {
          const newLog = payload.new as any;
          
          // Check if this is a critical action
          if (CRITICAL_ACTIONS.includes(newLog.action)) {
            // Don't notify for own actions
            if (newLog.user_id === profile?.id) return;
            
            // Get user name
            let userName = "Someone";
            if (newLog.user_id) {
              const { data: userProfile } = await supabase
                .from("profiles")
                .select("full_name")
                .eq("id", newLog.user_id)
                .single();
              userName = userProfile?.full_name || "Someone";
            }
            
            const actionLabel = getActionConfig(newLog.action).label;
            
            toast({
              title: `⚠️ Critical Audit Event`,
              description: `${userName} performed: ${actionLabel} on ${newLog.entity_type}`,
              variant: "destructive",
            });
          }
          
          // Refresh the list if on first page
          if (page === 0) {
            fetchLogs();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurant?.tenant_id, isOwner, profile?.id, page]);

  // Fetch all logs for export (no pagination)
  const fetchAllLogsForExport = async (): Promise<AuditLog[]> => {
    if (!restaurant?.tenant_id) return [];

    try {
      let query = supabase
        .from("audit_logs")
        .select("*")
        .eq("tenant_id", restaurant.tenant_id)
        .order("created_at", { ascending: false });

      if (actionFilter !== "all") {
        query = query.eq("action", actionFilter);
      }

      if (entityFilter !== "all") {
        query = query.eq("entity_type", entityFilter);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Fetch user emails
      const userIds = [...new Set(data?.filter(l => l.user_id).map(l => l.user_id))] as string[];
      let userMap = new Map<string, string>();
      
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        
        userMap = new Map(profiles?.map(p => [p.id, p.full_name || "Unknown"]) || []);
      }

      return (data || []).map(log => ({
        ...log,
        user_email: log.user_id ? userMap.get(log.user_id) || "Unknown" : "System",
      }));
    } catch (error) {
      console.error("Error fetching all audit logs:", error);
      return [];
    }
  };

  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      const allLogs = await fetchAllLogsForExport();
      
      const headers = ["Timestamp", "User", "Action", "Entity Type", "Entity ID", "Old Data", "New Data"];
      const rows = allLogs.map(log => [
        format(new Date(log.created_at), "yyyy-MM-dd HH:mm:ss"),
        log.user_email || "System",
        getActionConfig(log.action).label,
        log.entity_type,
        log.entity_id || "-",
        log.old_data ? JSON.stringify(log.old_data) : "-",
        log.new_data ? JSON.stringify(log.new_data) : "-",
      ]);

      exportToCSV({
        headers,
        rows,
        filename: `Audit_Logs_${restaurant?.name || "Export"}`,
      });

      toast({ title: "Export complete", description: `Exported ${allLogs.length} audit logs to CSV` });
    } catch (error) {
      console.error("Export error:", error);
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      const allLogs = await fetchAllLogsForExport();
      
      const headers = ["Timestamp", "User", "Action", "Entity Type", "Entity ID"];
      const rows = allLogs.map(log => [
        format(new Date(log.created_at), "yyyy-MM-dd HH:mm"),
        log.user_email || "System",
        getActionConfig(log.action).label,
        log.entity_type,
        log.entity_id ? log.entity_id.slice(0, 8) + "..." : "-",
      ]);

      exportToPDF({
        headers,
        rows,
        filename: `Audit_Logs_${restaurant?.name || "Export"}`,
      });

      toast({ title: "Export complete", description: `Exported ${allLogs.length} audit logs to PDF` });
    } catch (error) {
      console.error("Export error:", error);
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const filteredLogs = logs.filter(log => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      log.action.toLowerCase().includes(query) ||
      log.entity_type.toLowerCase().includes(query) ||
      log.user_email?.toLowerCase().includes(query) ||
      log.entity_id?.toLowerCase().includes(query)
    );
  });

  const formatTimestamp = (dateString: string) => {
    try {
      return format(new Date(dateString), "MMM d, yyyy 'at' h:mm a");
    } catch {
      return dateString;
    }
  };

  const getActionConfig = (action: string) => {
    return actionConfig[action] || { 
      label: action, 
      className: "bg-muted text-muted-foreground", 
      icon: Edit 
    };
  };

  const uniqueActions = [...new Set(logs.map(l => l.action))];
  const uniqueEntities = [...new Set(logs.map(l => l.entity_type))];

  if (!isOwner) {
    return null;
  }

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 fade-slide-in mb-6 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
              Audit Logs
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Track all changes and overrides made in your restaurant
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={isExporting} className="gap-2">
                {isExporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportCSV}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Export as CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPDF}>
                <FileText className="h-4 w-4 mr-2" />
                Export as PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6 fade-slide-in" style={{ animationDelay: "50ms" }}>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(0); }}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter by action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {uniqueActions.map(action => (
                <SelectItem key={action} value={action}>
                  {getActionConfig(action).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entityFilter} onValueChange={(v) => { setEntityFilter(v); setPage(0); }}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Filter by entity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Entities</SelectItem>
              {uniqueEntities.map(entity => (
                <SelectItem key={entity} value={entity}>
                  {entity}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Logs Table */}
        <div className="rounded-lg border bg-card fade-slide-in" style={{ animationDelay: "100ms" }}>
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Clock className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No audit logs found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Entity ID</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map((log) => {
                  const config = getActionConfig(log.action);
                  const ActionIcon = config.icon;

                  return (
                    <TableRow key={log.id}>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{formatTimestamp(log.created_at)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium">{log.user_email}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={config.className}>
                          <ActionIcon className="h-3 w-3 mr-1" />
                          {config.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm capitalize">{log.entity_type}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground font-mono">
                          {log.entity_id ? log.entity_id.slice(0, 8) + "..." : "-"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setSelectedLog(log)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {/* Pagination */}
          {!isLoading && filteredLogs.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">
                Page {page + 1}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => p + 1)}
                  disabled={!hasMore}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Detail Modal */}
        <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
          <DialogContent
            description={
              selectedLog
                ? `${getActionConfig(selectedLog.action).label} on ${selectedLog.entity_type}${selectedLog.entity_id ? ` (${String(selectedLog.entity_id).slice(0, 8)})` : ""} by ${selectedLog.user_email} at ${formatTimestamp(selectedLog.created_at)}.`
                : "Audit log entry details."
            }
            className="max-w-2xl max-h-[80vh] overflow-y-auto"
          >
            <DialogHeader>
              <DialogTitle>Audit Log Details</DialogTitle>
            </DialogHeader>
            {selectedLog && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Timestamp</p>
                    <p className="text-sm font-medium">{formatTimestamp(selectedLog.created_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">User</p>
                    <p className="text-sm font-medium">{selectedLog.user_email}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Action</p>
                    <Badge className={getActionConfig(selectedLog.action).className}>
                      {getActionConfig(selectedLog.action).label}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Entity</p>
                    <p className="text-sm font-medium capitalize">{selectedLog.entity_type}</p>
                  </div>
                </div>

                {selectedLog.entity_id && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Entity ID</p>
                    <p className="text-sm font-mono bg-muted p-2 rounded">{selectedLog.entity_id}</p>
                  </div>
                )}

                {selectedLog.old_data && Object.keys(selectedLog.old_data).length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Previous Data</p>
                    <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                      {JSON.stringify(selectedLog.old_data, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedLog.new_data && Object.keys(selectedLog.new_data).length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">New Data</p>
                    <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                      {JSON.stringify(selectedLog.new_data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
