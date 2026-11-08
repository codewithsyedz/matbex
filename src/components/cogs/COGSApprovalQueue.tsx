import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  CheckCircle,
  XCircle,
  Eye,
  Clock,
  AlertTriangle,
  User,
  FileCheck,
  Percent,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/useCurrency";
import {
  useCOGSSubmissions,
  COGSSubmission,
  SHIFT_TYPES,
} from "@/hooks/useCOGSSubmissions";
import { DailyCOGSEntryForm } from "./DailyCOGSEntryForm";
import { format } from "date-fns";

export function COGSApprovalQueue() {
  const { format: formatCurrency } = useCurrency();
  const { pendingApprovals, isLoading, approveSubmission, rejectSubmission, getFoodCostStatus } = useCOGSSubmissions();
  
  const [selectedSubmission, setSelectedSubmission] = useState<COGSSubmission | null>(null);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [submissionToReject, setSubmissionToReject] = useState<string | null>(null);

  const handleApprove = (id: string) => {
    approveSubmission.mutate(id);
  };

  const handleRejectClick = (id: string) => {
    setSubmissionToReject(id);
    setRejectionReason("");
    setShowRejectDialog(true);
  };

  const handleRejectConfirm = () => {
    if (!submissionToReject || !rejectionReason.trim()) return;
    
    rejectSubmission.mutate({
      id: submissionToReject,
      reason: rejectionReason,
    }, {
      onSuccess: () => {
        setShowRejectDialog(false);
        setSubmissionToReject(null);
        setRejectionReason("");
      },
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            Pending Approvals
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!pendingApprovals || pendingApprovals.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            Pending Approvals
          </CardTitle>
          <CardDescription>Review and approve COGS submissions from cashiers</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <CheckCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No pending submissions</p>
            <p className="text-sm">All COGS submissions have been reviewed</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <FileCheck className="h-5 w-5" />
                Pending Approvals
                <Badge variant="secondary">{pendingApprovals.length}</Badge>
              </CardTitle>
              <CardDescription>Review and approve COGS submissions from cashiers</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Cashier</TableHead>
                <TableHead className="text-right">COGS</TableHead>
                <TableHead className="text-right">Food Cost %</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingApprovals.map((submission) => {
                const foodCostStatus = getFoodCostStatus(submission.food_cost_percentage);
                return (
                  <TableRow key={submission.id}>
                    <TableCell className="font-medium">
                      {format(new Date(submission.submission_date), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      {SHIFT_TYPES.find(s => s.value === submission.shift_type)?.label || submission.shift_type}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        {submission.cashier_name}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(submission.cogs)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className={cn("font-semibold", foodCostStatus.color)}>
                          {submission.food_cost_percentage.toFixed(1)}%
                        </span>
                        {foodCostStatus.status !== 'healthy' && (
                          <AlertTriangle className={cn("h-4 w-4", foodCostStatus.color)} />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {submission.submitted_at
                            ? format(new Date(submission.submitted_at), "h:mm a")
                            : "-"
                          }
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedSubmission(submission)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-success hover:text-success"
                          onClick={() => handleApprove(submission.id)}
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleRejectClick(submission.id)}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail Sheet */}
      <Sheet open={!!selectedSubmission} onOpenChange={() => setSelectedSubmission(null)}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Review COGS Submission</SheetTitle>
            <SheetDescription>
              Review the details before approving or rejecting
            </SheetDescription>
          </SheetHeader>
          {selectedSubmission && (
            <div className="mt-6">
              <DailyCOGSEntryForm
                submission={selectedSubmission}
                onClose={() => setSelectedSubmission(null)}
                readOnly
              />
              <div className="flex gap-3 mt-6 pt-4 border-t">
                <Button
                  variant="outline"
                  className="flex-1 text-destructive hover:text-destructive"
                  onClick={() => {
                    handleRejectClick(selectedSubmission.id);
                    setSelectedSubmission(null);
                  }}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Reject
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => {
                    handleApprove(selectedSubmission.id);
                    setSelectedSubmission(null);
                  }}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Approve
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Submission</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this COGS submission.
              The cashier will be notified and can make corrections.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Enter rejection reason..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectConfirm}
              disabled={!rejectionReason.trim()}
            >
              Reject Submission
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
