import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";
import { Download, Clock, CheckCircle, XCircle, AlertTriangle, FileDown } from "lucide-react";
import { format } from "date-fns";

interface ExportRequest {
  id: string;
  export_type: string;
  status: string;
  requested_at: string;
  reviewed_at: string | null;
  completed_at: string | null;
  row_count: number | null;
  rejection_reason: string | null;
  requested_by: string;
  approved_by: string | null;
  requester?: {
    full_name: string | null;
  };
}

interface TenantExportRequestsProps {
  tenantId: string;
}

const EXPORT_TYPE_LABELS: Record<string, string> = {
  sales: "Sales Transactions",
  expenses: "Expenses",
  shifts: "Shifts",
  inventory: "Inventory",
  full_backup: "Full Backup",
};

export function TenantExportRequests({ tenantId }: TenantExportRequestsProps) {
  const [requests, setRequests] = useState<ExportRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRequests = async () => {
    try {
      const { data, error } = await db
        .from("export_requests")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("requested_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      if (data && data.length > 0) {
        const userIds = [...new Set(data.map((r) => r.requested_by))];
        const { data: profiles } = await db
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);

        const requestsWithProfiles = data.map((request) => ({
          ...request,
          requester: profiles?.find((p) => p.id === request.requested_by),
        }));
        setRequests(requestsWithProfiles);
      } else {
        setRequests([]);
      }
    } catch (error) {
      console.error("Error fetching export requests:", error);
      toast.error("Failed to load export requests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [tenantId]);

  const getStatusBadge = (status: string) => {
    const config = {
      pending: { variant: "secondary" as const, icon: Clock, label: "Pending" },
      approved: { variant: "default" as const, icon: CheckCircle, label: "Approved" },
      rejected: { variant: "destructive" as const, icon: XCircle, label: "Rejected" },
      completed: { variant: "outline" as const, icon: FileDown, label: "Completed" },
      expired: { variant: "outline" as const, icon: AlertTriangle, label: "Expired" },
    };
    const { variant, icon: Icon, label } = config[status as keyof typeof config] || config.pending;
    return (
      <Badge variant={variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {label}
      </Badge>
    );
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Download className="h-4 w-4" />
          Export Requests
        </CardTitle>
        <CardDescription>
          Data export requests from this tenant
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : requests.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No export requests
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Requested By</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Reviewed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="font-medium">
                    {EXPORT_TYPE_LABELS[request.export_type] || request.export_type}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {request.requester?.full_name || "Unknown"}
                  </TableCell>
                  <TableCell>{getStatusBadge(request.status)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(request.requested_at), "MMM d, HH:mm")}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {request.reviewed_at
                      ? format(new Date(request.reviewed_at), "MMM d, HH:mm")
                      : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}