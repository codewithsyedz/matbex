import { useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Delete, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface CashDropSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shiftId: string;
  onSuccess?: () => void;
}

export function CashDropSheet({ open, onOpenChange, shiftId, onSuccess }: CashDropSheetProps) {
  const { user, restaurant } = useAuth();
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleKeyPress = (key: string) => {
    if (key === "." && amount.includes(".")) return;
    if (amount.includes(".") && amount.split(".")[1]?.length >= 2) return;
    setAmount((prev) => prev + key);
  };

  const handleBackspace = () => {
    setAmount((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    setAmount("");
  };

  const handleSubmit = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    if (!user || !restaurant) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("cash_events").insert({
        shift_id: shiftId,
        restaurant_id: restaurant.id,
        event_type: "drop",
        amount: parseFloat(amount),
        description: notes || null,
        created_by: user.id,
      });

      if (error) throw error;

      toast.success(`Cash drop of $${parseFloat(amount).toFixed(2)} recorded`);
      setAmount("");
      setNotes("");
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error("Error recording cash drop:", error);
      toast.error("Failed to record cash drop");
    } finally {
      setIsSubmitting(false);
    }
  };

  const numpadKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader className="text-center pb-2">
          <DrawerTitle className="text-lg">Record Cash Drop</DrawerTitle>
          <DrawerDescription>
            Enter the amount being removed from the drawer
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-6 pb-4 space-y-6">
          {/* Amount Display */}
          <div className="text-center py-6 bg-muted/30 rounded-lg">
            <div className="text-4xl font-semibold tracking-tight tabular-nums">
              <span className="text-muted-foreground">$</span>
              <span className={amount ? "text-foreground" : "text-muted-foreground"}>
                {amount || "0.00"}
              </span>
            </div>
          </div>

          {/* Numeric Keypad */}
          <div className="grid grid-cols-3 gap-2">
            {numpadKeys.map((key) => (
              <Button
                key={key}
                variant="outline"
                size="lg"
                className="h-14 text-xl font-medium transition-transform active:scale-95"
                onClick={() => handleKeyPress(key)}
              >
                {key}
              </Button>
            ))}
            <Button
              variant="outline"
              size="lg"
              className="h-14"
              onClick={handleBackspace}
            >
              <Delete className="h-5 w-5" />
            </Button>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes" className="text-sm text-muted-foreground">
              Notes (optional)
            </Label>
            <Textarea
              id="notes"
              placeholder="e.g., Safe deposit, manager pickup..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-none h-16"
            />
          </div>
        </div>

        <DrawerFooter className="pt-2">
          <Button
            size="lg"
            onClick={handleSubmit}
            disabled={!amount || parseFloat(amount) <= 0 || isSubmitting}
            className="w-full"
          >
            <Check className="h-4 w-4 mr-2" />
            Record Drop
          </Button>
          <DrawerClose asChild>
            <Button variant="outline" size="lg" onClick={handleClear}>
              Cancel
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
