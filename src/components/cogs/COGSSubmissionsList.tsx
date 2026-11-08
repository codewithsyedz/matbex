import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Plus,
  Eye,
  CalendarIcon,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
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

export function COGSSubmissionsList() {
  const { format: formatCurrency } = useCurrency();
  const { submissions, isLoading, createSubmission, getFoodCostStatus } = useCOGSSubmissions();
  
  const [selectedSubmission, setSelectedSubmission] = useState<COGSSubmission | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newDate, setNewDate] = useState<Date>(new Date());
  const [newShiftType, setNewShiftType] = useState("full");

  const handleCreateSubmission = () => {
    createSubmission.mutate({
      submission_date: format(newDate, "yyyy-MM-dd"),
      shift_type: newShiftType,
    }, {
      onSuccess: (data) => {
        setShowNewDialog(false);
        setSelectedSubmission(data);
      },
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-success/20 text-success border-success/30"><CheckCircle className="h-3 w-3 mr-1" />Approved</Badge>;
      case 'rejected':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      case 'submitted':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      default:
        return <Badge variant="outline">Draft</Badge>;
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Daily COGS Submissions
              </CardTitle>
              <CardDescription>Track daily food cost submissions by shift</CardDescription>
            </div>
            <Button onClick={() => setShowNewDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Entry
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="animate-pulse space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-muted rounded-lg" />
              ))}
            </div>
          ) : submissions && submissions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead className="text-right">COGS</TableHead>
                  <TableHead className="text-right">Food Cost %</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.slice(0, 20).map((submission) => {
                  const foodCostStatus = getFoodCostStatus(submission.food_cost_percentage);
                  return (
                    <TableRow key={submission.id}>
                      <TableCell className="font-medium">
                        {format(new Date(submission.submission_date), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        {SHIFT_TYPES.find(s => s.value === submission.shift_type)?.label || submission.shift_type}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(submission.cogs)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span className={cn("font-semibold", foodCostStatus.color)}>
                            {submission.food_cost_percentage.toFixed(1)}%
                          </span>
                          {foodCostStatus.status !== 'healthy' && (
                            <AlertTriangle className={cn("h-3 w-3", foodCostStatus.color)} />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(submission.status)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedSubmission(submission)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No submissions yet</p>
              <p className="text-sm">Create your first daily COGS entry</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* New Submission Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New COGS Entry</DialogTitle>
            <DialogDescription>Start a new daily COGS submission</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start mt-1">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(newDate, "MMMM d, yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={newDate}
                    onSelect={(d) => d && setNewDate(d)}
                    disabled={(d) => d > new Date()}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <label className="text-sm font-medium">Shift</label>
              <Select value={newShiftType} onValueChange={setNewShiftType}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHIFT_TYPES.map((shift) => (
                    <SelectItem key={shift.value} value={shift.value}>
                      {shift.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateSubmission}>Create Entry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Sheet */}
      <Sheet open={!!selectedSubmission} onOpenChange={() => setSelectedSubmission(null)}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>COGS Entry Details</SheetTitle>
          </SheetHeader>
          {selectedSubmission && (
            <div className="mt-6">
              <DailyCOGSEntryForm
                submission={selectedSubmission}
                onClose={() => setSelectedSubmission(null)}
                readOnly={selectedSubmission.status !== 'draft'}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
