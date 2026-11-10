import { useState } from "react";
import { addBalanceAdjustment } from "@/lib/api/credit";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, TrendingDown, TrendingUp, AlertCircle, FileX, CalendarIcon } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

type AdjustmentType = "credit" | "debit" | "correction" | "write_off";

interface BalanceAdjustmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: {
    id: string;
    name: string;
    current_balance: number;
  };
}

const ADJUSTMENT_TYPES = [
  {
    value: "credit" as AdjustmentType,
    label: "Credit (Reduce Balance)",
    description: "Payment received or balance reduction",
    icon: TrendingDown,
    color: "text-emerald-600",
  },
  {
    value: "debit" as AdjustmentType,
    label: "Debit (Increase Balance)",
    description: "Add charges to the balance",
    icon: TrendingUp,
    color: "text-amber-600",
  },
  {
    value: "correction" as AdjustmentType,
    label: "Correction",
    description: "Fix a data entry error",
    icon: AlertCircle,
    color: "text-blue-600",
  },
  {
    value: "write_off" as AdjustmentType,
    label: "Write Off",
    description: "Write off uncollectable balance",
    icon: FileX,
    color: "text-red-600",
  },
];

export function BalanceAdjustmentDialog({
  open,
  onOpenChange,
  customer,
}: BalanceAdjustmentDialogProps) {
  const { user, restaurant, tenant } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();

  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("credit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [adjustmentDate, setAdjustmentDate] = useState<Date>(new Date());

  const selectedType = ADJUSTMENT_TYPES.find((t) => t.value === adjustmentType);

  const calculateNewBalance = () => {
    const amountValue = parseFloat(amount) || 0;
    if (adjustmentType === "credit" || adjustmentType === "write_off") {
      return Math.max(0, customer.current_balance - amountValue);
    }
    return customer.current_balance + amountValue;
  };

  const adjustmentMutation = useMutation({
    mutationFn: async () => {
      if (!restaurant?.id || !user?.id || !tenant?.id) {
        throw new Error("Missing context");
      }

      const amountValue = parseFloat(amount);
      if (isNaN(amountValue) || amountValue <= 0) {
        throw new Error("Please enter a valid amount greater than 0");
      }

      if (!reason.trim()) {
        throw new Error("Please provide a reason for this adjustment");
      }

      // POST /api/v1/credit/adjustments (the server recomputes the balance).
      await addBalanceAdjustment({
        restaurantId: restaurant.id,
        customerId: customer.id,
        type: adjustmentType,
        amount: amountValue,
        reason: reason.trim(),
        notes: notes.trim() || null,
        createdAt: adjustmentDate.toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer", customer.id] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer-adjustments", customer.id] });
      toast.success("Balance adjustment recorded successfully");
      resetForm();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to record adjustment");
    },
  });

  const resetForm = () => {
    setAdjustmentType("credit");
    setAmount("");
    setReason("");
    setNotes("");
    setAdjustmentDate(new Date());
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) resetForm();
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Adjust Balance</DialogTitle>
          <DialogDescription>
            Record a manual balance adjustment for {customer.name}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[60vh] pr-4 overflow-y-auto" type="auto">
          <div className="space-y-4 py-2">
          {/* Current Balance */}
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-sm text-muted-foreground">Current Balance</p>
            <p className="text-2xl font-bold text-amber-600">
              {formatCurrency(customer.current_balance)}
            </p>
          </div>

          {/* Adjustment Type */}
          <div className="space-y-2">
            <Label>Adjustment Type</Label>
            <Select
              value={adjustmentType}
              onValueChange={(v) => setAdjustmentType(v as AdjustmentType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADJUSTMENT_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    <div className="flex items-center gap-2">
                      <type.icon className={`h-4 w-4 ${type.color}`} />
                      <div>
                        <span>{type.label}</span>
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedType && (
              <p className="text-xs text-muted-foreground">{selectedType.description}</p>
            )}
          </div>

          {/* Adjustment Date */}
          <div className="space-y-2">
            <Label>Adjustment Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !adjustmentDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {adjustmentDate ? format(adjustmentDate, "PPP") : "Select date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={adjustmentDate}
                  onSelect={(date) => date && setAdjustmentDate(date)}
                  disabled={(date) => date > new Date()}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          {/* Reason (Required) */}
          <div className="space-y-2">
            <Label htmlFor="reason">
              Reason <span className="text-red-500">*</span>
            </Label>
            <Input
              id="reason"
              placeholder="e.g., Payment received via bank transfer"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {/* Additional Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Additional Notes</Label>
            <Textarea
              id="notes"
              placeholder="Optional additional details..."
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* New Balance Preview */}
          {amount && parseFloat(amount) > 0 && (
            <div className="bg-muted/50 rounded-lg p-3 border-l-4 border-primary">
              <p className="text-sm text-muted-foreground">New Balance After Adjustment</p>
              <p className="text-2xl font-bold">{formatCurrency(calculateNewBalance())}</p>
            </div>
          )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => adjustmentMutation.mutate()}
            disabled={adjustmentMutation.isPending || !amount || !reason.trim()}
          >
            {adjustmentMutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Record Adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
