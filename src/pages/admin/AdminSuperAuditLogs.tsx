import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useSuperAdminAudit } from "@/hooks/useSuperAdminAudit";
import { 
  Shield, 
  RefreshCw, 
  Download, 
  Filter, 
  Search,
  ChevronRight,
  User,
  Building2,
  Settings,
  FileDown,
  Key,
  UserX,
  Unlock,
  Eye,
  Calendar
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import type { Json } from "@/integrations/supabase/types";

const getOutcome = (context: Json): "success" | "failure" | "unknown" => {
  if (context && typeof context === "object" && !Array.isArray(context)) {
    const o = (context as Record<string, unknown>).outcome;
    if (o === "failure" || o === "error") return "failure";
    if (o === "success") return "success";
  }
  return "success"; // legacy events without explicit outcome are treated as successful
};

interface AuditEvent {
  id: string;
  timestamp: string;
  actor_id: string;
  actor_email: string;
  actor_role: string;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string;
  action_type: string;
  target_type: string;
  target_id: string | null;
  target_identifier: string | null;
  metadata_before: Json;
  metadata_after: Json;
  context: Json;
  summary: string | null;
  event_hash: string | null;
}

const ACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  TENANT_CREATE: Building2,
  TENANT_STATUS_CHANGE: Building2,
  TENANT_DELETE: Building2,
  PLAN_CHANGE: Settings,
  FEATURE_TOGGLE: Settings,
  USER_ROLE_CHANGE: User,
  ACCOUNT_UNLOCK: Unlock,
  SESSION_REVOKE: UserX,
  DATA_EXPORT: FileDown,
  DATA_EXPORT_APPROVE: FileDown,
  DATA_EXPORT_REJECT: FileDown,
  AUDIT_LOG_EXPORT: Download,
  IMPERSONATION_START: Eye,
  IMPERSONATION_END: Eye,
  WEBHOOK_CONFIG_CHANGE: Settings,
  API_TOKEN_CREATE: Key,
  API_TOKEN_REVOKE: Key,
};

const ACTION_COLORS: Record<string, string> = {
  TENANT_CREATE: "bg-green-500/10 text-green-600 border-green-500/20",
  TENANT_STATUS_CHANGE: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  TENANT_DELETE: "bg-red-500/10 text-red-600 border-red-500/20",
  PLAN_CHANGE: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  FEATURE_TOGGLE: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  USER_ROLE_CHANGE: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  ACCOUNT_UNLOCK: "bg-green-500/10 text-green-600 border-green-500/20",
  SESSION_REVOKE: "bg-red-500/10 text-red-600 border-red-500/20",
  DATA_EXPORT_APPROVE: "bg-green-500/10 text-green-600 border-green-500/20",
  DATA_EXPORT_REJECT: "bg-red-500/10 text-red-600 border-red-500/20",
  IMPERSONATION_START: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  IMPERSONATION_END: "bg-blue-500/10 text-blue-600 border-blue-500/20",
};

export default function AdminSuperAuditLogs() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [targetFilter, setTargetFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { logAuditLogExport } = useSuperAdminAudit();

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("superadmin_audit_events")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(500);

      if (dateFrom) {
        query = query.gte("timestamp", new Date(dateFrom).toISOString());
      }
      if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setDate(toDate.getDate() + 1);
        query = query.lt("timestamp", toDate.toISOString());
      }

      const { data, error } = await query;

      if (error) throw error;
      setEvents(data || []);
    } catch (error) {
      console.error("Error fetching audit events:", error);
      toast.error("Failed to load audit events");
    } finally {
      setLoading(false);
    }
  };

  const filteredEvents = events.filter((event) => {
    if (searchQuery) {
      const search = searchQuery.toLowerCase();
      if (
        !event.actor_email.toLowerCase().includes(search) &&
        !event.summary?.toLowerCase().includes(search) &&
        !event.target_identifier?.toLowerCase().includes(search)
      ) {
        return false;
      }
    }
    if (actionFilter !== "all" && event.action_type !== actionFilter) return false;
    if (targetFilter !== "all" && event.target_type !== targetFilter) return false;
    return true;
  });

  const handleExport = async (format: "json" | "csv") => {
    const exportData = filteredEvents.map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      actor_email: e.actor_email,
      action_type: e.action_type,
      target_type: e.target_type,
      target_identifier: e.target_identifier,
      summary: e.summary,
      ip_address: e.ip_address,
      metadata_before: JSON.stringify(e.metadata_before),
      metadata_after: JSON.stringify(e.metadata_after),
      context: JSON.stringify(e.context),
    }));

    // Log the export
    await logAuditLogExport(
      { searchQuery, actionFilter, targetFilter, dateFrom, dateTo },
      exportData.length
    );

    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === "json") {
      content = JSON.stringify(exportData, null, 2);
      filename = `superadmin-audit-${new Date().toISOString().split("T")[0]}.json`;
      mimeType = "application/json";
    } else {
      const headers = Object.keys(exportData[0] || {});
      const csvRows = [
        headers.join(","),
        ...exportData.map((row) =>
          headers.map((h) => `"${String(row[h as keyof typeof row] || "").replace(/"/g, '""')}"`).join(",")
        ),
      ];
      content = csvRows.join("\n");
      filename = `superadmin-audit-${new Date().toISOString().split("T")[0]}.csv`;
      mimeType = "text/csv";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${exportData.length} events as ${format.toUpperCase()}`);
  };

  const getActionIcon = (actionType: string) => {
    const Icon = ACTION_ICONS[actionType] || Shield;
    return <Icon className="h-4 w-4" />;
  };

  const getActionBadgeClass = (actionType: string) => {
    return ACTION_COLORS[actionType] || "bg-muted text-muted-foreground";
  };

  const uniqueActions = [...new Set(events.map((e) => e.action_type))].sort();
  const uniqueTargets = [...new Set(events.map((e) => e.target_type))].sort();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SuperAdmin Audit Log</h1>
          <p className="text-muted-foreground">Immutable record of all privileged actions</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="h-4 w-4 mr-2" />
            Filters
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport("csv")}>
            <Download className="h-4 w-4 mr-2" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport("json")}>
            <Download className="h-4 w-4 mr-2" />
            JSON
          </Button>
          <Button variant="outline" size="sm" onClick={fetchEvents}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

        {/* Filters Panel */}
        {showFilters && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Filters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div className="space-y-2">
                  <Label>Search</Label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Actor, target, summary..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Action Type</Label>
                  <Select value={actionFilter} onValueChange={setActionFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All actions" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All actions</SelectItem>
                      {uniqueActions.map((action) => (
                        <SelectItem key={action} value={action}>
                          {action.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Target Type</Label>
                  <Select value={targetFilter} onValueChange={setTargetFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All targets" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All targets</SelectItem>
                      {uniqueTargets.map((target) => (
                        <SelectItem key={target} value={target}>
                          {target}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>From Date</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>To Date</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {filteredEvents.length} of {events.length} events
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery("");
                    setActionFilter("all");
                    setTargetFilter("all");
                    setDateFrom("");
                    setDateTo("");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Events Table */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Shield className="h-12 w-12 mb-4 opacity-50" />
                <p>No audit events found</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Timestamp</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead className="max-w-[300px]">Summary</TableHead>
                    <TableHead className="w-[110px]">Outcome</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEvents.map((event) => (
                    <TableRow
                      key={event.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedEvent(event)}
                    >
                      <TableCell className="font-mono text-xs">
                        {format(new Date(event.timestamp), "MMM d, HH:mm:ss.SSS")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-xs font-medium text-primary">
                              {event.actor_email.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm">{event.actor_email}</span>
                            <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[180px]">
                              {event.actor_id}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getActionBadgeClass(event.action_type)}>
                          {getActionIcon(event.action_type)}
                          <span className="ml-1">{event.action_type.replace(/_/g, " ")}</span>
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm capitalize">{event.target_type}</span>
                          {event.target_identifier && (
                            <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                              {event.target_identifier}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate text-sm text-muted-foreground">
                        {event.summary || "-"}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const outcome = getOutcome(event.context);
                          if (outcome === "failure") {
                            return (
                              <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">
                                Failure
                              </Badge>
                            );
                          }
                          return (
                            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                              Success
                            </Badge>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Event Detail Dialog */}
        <Dialog open={!!selectedEvent} onOpenChange={() => setSelectedEvent(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {selectedEvent && getActionIcon(selectedEvent.action_type)}
                Audit Event Details
              </DialogTitle>
              <DialogDescription>
                {selectedEvent?.summary || "No summary available"}
              </DialogDescription>
            </DialogHeader>
            
            {selectedEvent && (
              <Tabs defaultValue="overview" className="flex-1 overflow-hidden">
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="changes">Before/After</TabsTrigger>
                  <TabsTrigger value="context">Context</TabsTrigger>
                  <TabsTrigger value="integrity">Integrity</TabsTrigger>
                </TabsList>

                <ScrollArea className="flex-1 mt-4">
                  <TabsContent value="overview" className="m-0">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Event ID</Label>
                        <p className="font-mono text-sm">{selectedEvent.id}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Timestamp</Label>
                        <p className="text-sm">{format(new Date(selectedEvent.timestamp), "PPpp")}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Actor</Label>
                        <p className="text-sm">{selectedEvent.actor_email}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Actor Role</Label>
                        <Badge variant="outline">{selectedEvent.actor_role}</Badge>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Action Type</Label>
                        <Badge className={getActionBadgeClass(selectedEvent.action_type)}>
                          {selectedEvent.action_type}
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Target Type</Label>
                        <p className="text-sm capitalize">{selectedEvent.target_type}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Target ID</Label>
                        <p className="font-mono text-sm">{selectedEvent.target_id || "-"}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Target Identifier</Label>
                        <p className="text-sm">{selectedEvent.target_identifier || "-"}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">IP Address</Label>
                        <p className="font-mono text-sm">{selectedEvent.ip_address || "-"}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">User Agent</Label>
                        <p className="text-sm truncate">{selectedEvent.user_agent || "-"}</p>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="changes" className="m-0">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Before</Label>
                        <pre className="bg-muted p-3 rounded-md text-xs overflow-auto max-h-[300px]">
                          {JSON.stringify(selectedEvent.metadata_before, null, 2) || "{}"}
                        </pre>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">After</Label>
                        <pre className="bg-muted p-3 rounded-md text-xs overflow-auto max-h-[300px]">
                          {JSON.stringify(selectedEvent.metadata_after, null, 2) || "{}"}
                        </pre>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="context" className="m-0">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Request ID</Label>
                        <p className="font-mono text-sm">{selectedEvent.request_id}</p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Additional Context</Label>
                        <pre className="bg-muted p-3 rounded-md text-xs overflow-auto max-h-[200px]">
                          {JSON.stringify(selectedEvent.context, null, 2) || "{}"}
                        </pre>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="integrity" className="m-0">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Event Hash</Label>
                        <p className="font-mono text-xs break-all bg-muted p-2 rounded">
                          {selectedEvent.event_hash || "N/A"}
                        </p>
                      </div>
                      <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-md">
                        <div className="flex items-center gap-2 text-green-600">
                          <Shield className="h-4 w-4" />
                          <span className="text-sm font-medium">Immutable Record</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          This audit event is cryptographically linked to previous events and cannot be modified or deleted.
                        </p>
                      </div>
                    </div>
                  </TabsContent>
                </ScrollArea>
              </Tabs>
            )}
          </DialogContent>
        </Dialog>
      </div>
  );
}
