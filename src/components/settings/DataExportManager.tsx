import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
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
  expires_at: string | null;
}

const EXPORT_TYPES = [
  { value: "sales", label: "Sales Transactions" },
  { value: "expenses", label: "Expenses" },
  { value: "shifts", label: "Shifts" },
  { value: "inventory", label: "Inventory" },
  { value: "full_backup", label: "Full Backup" },
];

export function DataExportManager() {
  const { user, tenant, isOwner } = useAuth();
  const [requests, setRequests] = useState<ExportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<string>("");
  const [isRequestDialogOpen, setIsRequestDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  const tenantId = tenant?.id;

  

  const fetchRequests = async () => {
    if (!tenantId) return;

    try {
      const { data, error } = await supabase
        .from("export_requests")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("requested_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      setRequests(data || []);
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

  const handleRequestExport = async () => {
    if (!selectedType || !tenantId || !user) return;

    setSubmitting(true);
    try {
      const { error } = await supabase.from("export_requests").insert({
        tenant_id: tenantId,
        requested_by: user.id,
        export_type: selectedType,
        data_scope: { requested_at: new Date().toISOString() },
      });

      if (error) throw error;

      toast.success("Export request submitted for approval");
      setIsRequestDialogOpen(false);
      setSelectedType("");
      fetchRequests();
    } catch (error) {
      console.error("Error requesting export:", error);
      toast.error("Failed to submit export request");
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from("export_requests")
        .update({
          status: "approved",
          approved_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      if (error) throw error;
      toast.success("Export request approved");
      fetchRequests();
    } catch (error) {
      console.error("Error approving export:", error);
      toast.error("Failed to approve export request");
    }
  };

  const handleReject = async (requestId: string, reason: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from("export_requests")
        .update({
          status: "rejected",
          approved_by: user.id,
          reviewed_at: new Date().toISOString(),
          rejection_reason: reason || "Request denied by owner",
        })
        .eq("id", requestId);

      if (error) throw error;
      toast.success("Export request rejected");
      fetchRequests();
    } catch (error) {
      console.error("Error rejecting export:", error);
      toast.error("Failed to reject export request");
    }
  };

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

  const getExportTypeLabel = (type: string) => {
    return EXPORT_TYPES.find((t) => t.value === type)?.label || type;
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Download className="h-4 w-4" />
              Data Exports
            </CardTitle>
            <CardDescription>
              Request bulk data exports (requires owner approval)
            </CardDescription>
          </div>
          <Dialog open={isRequestDialogOpen} onOpenChange={setIsRequestDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                Request Export
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Request Data Export</DialogTitle>
                <DialogDescription>
                  Select the type of data you want to export. This request will be sent to the owner for approval.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Export Type</label>
                  <Select value={selectedType} onValueChange={setSelectedType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select data to export" />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPORT_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsRequestDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleRequestExport} disabled={!selectedType || submitting}>
                  {submitting ? "Submitting..." : "Submit Request"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : requests.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No export requests yet
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Reviewed</TableHead>
                {isOwner && <TableHead>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="font-medium">
                    {getExportTypeLabel(request.export_type)}
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
                  {isOwner && (
                    <TableCell>
                      {request.status === "pending" && (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleApprove(request.id)}
                          >
                            Approve
                          </Button>
                          <RejectDialog onReject={(reason) => handleReject(request.id, reason)} />
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function RejectDialog({ onReject }: { onReject: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const handleReject = () => {
    onReject(reason);
    setOpen(false);
    setReason("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Reject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject Export Request</DialogTitle>
          <DialogDescription>
            Optionally provide a reason for rejecting this export request.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder="Reason for rejection (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleReject}>
            Reject Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}