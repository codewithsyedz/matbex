import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { db } from "@/integrations/db/client";
import { useSuperAdmin } from "@/contexts/SuperAdminContext";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Building2,
  FileText,
  Check,
  X,
  Eye,
  Clock,
  Mail,
  MapPin,
  Store,
  Loader2,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApplicationDocumentsPanel } from "@/components/admin/applications/ApplicationDocumentsPanel";

interface TenantApplication {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  country: string;
  referral_code: string | null;
  company_name: string;
  cr_number: string | null;
  vat_number: string | null;
  cr_document_url: string | null;
  restaurant_name: string | null;
  restaurant_type: string | null;
  estimated_monthly_revenue: string | null;
  location_count: number;
  plan_id: string | null;
  billing_interval: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  review_notes: string | null;
  tenant_id: string | null;
  credentials_sent_at: string | null;
  created_at: string;
  updated_at: string;
  plan?: { name: string; price: number } | null;
}

const statusColors: Record<string, string> = {
  prospect: "bg-muted text-muted-foreground",
  submitted: "bg-primary/10 text-primary",
  pending_approval: "bg-warning/10 text-warning",
  approved: "bg-success/10 text-success",
  rejected: "bg-destructive/10 text-destructive",
};

const restaurantTypeLabels: Record<string, string> = {
  fine_dining: "Fine Dining",
  qsr: "Quick Service",
  cafe: "Café",
  dark_kitchen: "Dark Kitchen",
  casual_dining: "Casual Dining",
  buffet: "Buffet",
};

export default function AdminApplicationQueue() {
  const navigate = useNavigate();
  const { isSuperAdmin } = useSuperAdmin();
  const [applications, setApplications] = useState<TenantApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedApp, setSelectedApp] = useState<TenantApplication | null>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [crDocSignedUrl, setCrDocSignedUrl] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");

  const fetchApplications = async () => {
    setLoading(true);
    try {
      const { data, error } = await db
        .from("tenant_applications")
        .select(`
          *,
          plan:plans(name, price)
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setApplications(data || []);
    } catch (error) {
      console.error("Error fetching applications:", error);
      toast.error("Failed to load applications");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin) {
      fetchApplications();
    }
  }, [isSuperAdmin]);

  const handleApprove = async () => {
    if (!selectedApp) return;
    setActionLoading(true);

    try {
      // Call edge function to handle approval (creates user, tenant, sends email)
      const { data, error } = await db.functions.invoke("approve-application", {
        body: {
          application_id: selectedApp.id,
          review_notes: reviewNotes || null,
        },
      });

      if (error) throw error;

      toast.success(`Application approved! Credentials sent to ${selectedApp.email}`);
      setReviewDialogOpen(false);
      setSelectedApp(null);
      setReviewNotes("");
      fetchApplications();
    } catch (error: any) {
      console.error("Error approving application:", error);
      toast.error(error.message || "Failed to approve application");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!selectedApp || !rejectionReason.trim()) {
      toast.error("Please provide a rejection reason");
      return;
    }
    setActionLoading(true);

    try {
      const { data: { user: currentUser } } = await db.auth.getUser();

      await db
        .from("tenant_applications")
        .update({
          status: "rejected",
          reviewed_by: currentUser?.id,
          reviewed_at: new Date().toISOString(),
          rejection_reason: rejectionReason,
          review_notes: reviewNotes || null,
        })
        .eq("id", selectedApp.id);

      toast.success("Application rejected");
      setReviewDialogOpen(false);
      setSelectedApp(null);
      setRejectionReason("");
      setReviewNotes("");
      fetchApplications();
    } catch (error: any) {
      console.error("Error rejecting application:", error);
      toast.error("Failed to reject application");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestInfo = async () => {
    if (!selectedApp) return;
    setActionLoading(true);

    try {
      // Update status to pending_approval (waiting for more info)
      await db
        .from("tenant_applications")
        .update({
          status: "pending_approval",
          review_notes: reviewNotes || "Additional information requested",
        })
        .eq("id", selectedApp.id);

      // TODO: Send email requesting more info

      toast.success("Information request sent");
      setReviewDialogOpen(false);
      setSelectedApp(null);
      setReviewNotes("");
      fetchApplications();
    } catch (error: any) {
      console.error("Error requesting info:", error);
      toast.error("Failed to send request");
    } finally {
      setActionLoading(false);
    }
  };

  const openReviewDialog = async (app: TenantApplication) => {
    setSelectedApp(app);
    setReviewNotes(app.review_notes || "");
    setRejectionReason(app.rejection_reason || "");
    setReviewDialogOpen(true);
    setCrDocSignedUrl(null);
    // application-docs bucket is private — fetch a fresh signed URL on open.
    if (app.cr_document_url) {
      try {
        const { data } = await db.functions.invoke(
          "application-verification?action=admin-list",
          { body: { applicationId: app.id } },
        );
        const url = (data as any)?.mirrorUrls?.cr_document_url ?? null;
        setCrDocSignedUrl(url);
      } catch {
        setCrDocSignedUrl(null);
      }
    }
  };

  const generateSecurePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
    let password = "";
    for (let i = 0; i < 16; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  const filteredApplications = applications.filter((app) => {
    const matchesSearch =
      app.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.company_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || app.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const pendingCount = applications.filter(
    (a) => a.status === "submitted" || a.status === "pending_approval"
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Application Queue
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review and approve tenant onboarding applications
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Review</p>
                <p className="text-2xl font-semibold text-amber-600">{pendingCount}</p>
              </div>
              <Clock className="w-8 h-8 text-amber-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Approved</p>
                <p className="text-2xl font-semibold text-emerald-600">
                  {applications.filter((a) => a.status === "approved").length}
                </p>
              </div>
              <Check className="w-8 h-8 text-emerald-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Rejected</p>
                <p className="text-2xl font-semibold text-red-600">
                  {applications.filter((a) => a.status === "rejected").length}
                </p>
              </div>
              <X className="w-8 h-8 text-red-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-semibold">{applications.length}</p>
              </div>
              <Building2 className="w-8 h-8 text-muted-foreground opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Applications Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-medium">Applications</CardTitle>
              <CardDescription>
                {filteredApplications.length} applications
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 w-64"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="pending_approval">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={fetchApplications}>
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : filteredApplications.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No applications found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredApplications.map((app) => (
                    <TableRow key={app.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell>
                        <div>
                          <p className="font-medium">{app.full_name}</p>
                          <p className="text-xs text-muted-foreground">{app.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{app.company_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {app.restaurant_name || "-"}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        {app.plan ? (
                          <div>
                            <p className="font-medium capitalize">{app.plan.name}</p>
                            <p className="text-xs text-muted-foreground">
                              ﷼{app.plan.price}/{app.billing_interval}
                            </p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColors[app.status] || statusColors.prospect}>
                          {app.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(app.created_at), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openReviewDialog(app)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Review Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Application</DialogTitle>
            <DialogDescription>
              Review the application details and take action
            </DialogDescription>
          </DialogHeader>

          {selectedApp && (
            <div className="space-y-6">
              {/* Status Badge */}
              <div className="flex items-center justify-between">
                <Badge className={statusColors[selectedApp.status] || statusColors.prospect}>
                  {selectedApp.status.replace("_", " ")}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Submitted {format(new Date(selectedApp.created_at), "PPp")}
                </span>
              </div>

              {/* Applicant Info */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Full Name</p>
                  <p className="font-medium">{selectedApp.full_name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Email</p>
                  <p className="font-medium">{selectedApp.email}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Phone</p>
                  <p className="font-medium">{selectedApp.phone || "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Country</p>
                  <p className="font-medium">{selectedApp.country}</p>
                </div>
              </div>

              {/* Company Info */}
              <div className="space-y-3">
                <h4 className="font-medium flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-emerald-500" />
                  Company Details
                </h4>
                <div className="grid grid-cols-2 gap-4 p-4 border rounded-lg">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Company Name</p>
                    <p className="font-medium">{selectedApp.company_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">CR Number</p>
                    <p className="font-medium">{selectedApp.cr_number || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">VAT Number</p>
                    <p className="font-medium">{selectedApp.vat_number || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">CR Document</p>
                    {selectedApp.cr_document_url ? (
                      <a
                        href={crDocSignedUrl ?? "#"}
                        onClick={(e) => { if (!crDocSignedUrl) e.preventDefault(); }}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "text-emerald-600 hover:underline flex items-center gap-1",
                          !crDocSignedUrl && "opacity-60 pointer-events-none"
                        )}
                      >
                        <FileText className="w-3 h-3" />
                        {crDocSignedUrl ? "View Document" : "Loading…"}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">Not uploaded</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Restaurant Info */}
              <div className="space-y-3">
                <h4 className="font-medium flex items-center gap-2">
                  <Store className="w-4 h-4 text-emerald-500" />
                  Restaurant Details
                </h4>
                <div className="grid grid-cols-2 gap-4 p-4 border rounded-lg">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Restaurant Name</p>
                    <p className="font-medium">{selectedApp.restaurant_name || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Type</p>
                    <p className="font-medium">
                      {selectedApp.restaurant_type
                        ? restaurantTypeLabels[selectedApp.restaurant_type] || selectedApp.restaurant_type
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Est. Monthly Revenue</p>
                    <p className="font-medium">{selectedApp.estimated_monthly_revenue || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Locations</p>
                    <p className="font-medium">{selectedApp.location_count}</p>
                  </div>
                </div>
              </div>

              {/* Plan Info */}
              {selectedApp.plan && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <p className="text-xs text-emerald-600 mb-1">Selected Plan</p>
                  <p className="font-medium text-lg capitalize">
                    {selectedApp.plan.name} - ﷼{selectedApp.plan.price}/{selectedApp.billing_interval}
                  </p>
                </div>
              )}

              {/* Verification Documents */}
              <div className="space-y-3">
                <h4 className="font-medium flex items-center gap-2">
                  <FileText className="w-4 h-4 text-emerald-500" />
                  Verification Documents
                </h4>
                <ApplicationDocumentsPanel applicationId={selectedApp.id} />
              </div>

              {/* Review Notes */}
              {selectedApp.status === "submitted" || selectedApp.status === "pending_approval" ? (
                <>
                  <div className="space-y-2">
                    <Label>Review Notes (Internal)</Label>
                    <Textarea
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      placeholder="Add internal notes about this application..."
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Rejection Reason (Required if rejecting)</Label>
                    <Textarea
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="Explain why this application is being rejected..."
                      rows={2}
                    />
                  </div>
                </>
              ) : (
                <>
                  {selectedApp.review_notes && (
                    <div className="p-4 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">Review Notes</p>
                      <p>{selectedApp.review_notes}</p>
                    </div>
                  )}
                  {selectedApp.rejection_reason && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-xs text-red-600 mb-1">Rejection Reason</p>
                      <p>{selectedApp.rejection_reason}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            {selectedApp && (selectedApp.status === "submitted" || selectedApp.status === "pending_approval") ? (
              <>
                <Button
                  variant="outline"
                  onClick={handleRequestInfo}
                  disabled={actionLoading}
                >
                  <AlertTriangle className="w-4 h-4 mr-2" />
                  Request More Info
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleReject}
                  disabled={actionLoading || !rejectionReason.trim()}
                >
                  <X className="w-4 h-4 mr-2" />
                  Reject
                </Button>
                <Button
                  onClick={handleApprove}
                  disabled={actionLoading}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  {actionLoading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  Approve & Initialize
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
