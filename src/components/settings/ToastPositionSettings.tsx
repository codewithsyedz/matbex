import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { TOAST_POSITIONS, ToastPosition } from "@/hooks/useToastSettings";

export function ToastPositionSettings() {
  const { restaurant, refreshProfile } = useAuth();
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<ToastPosition>(
    (restaurant?.toast_position as ToastPosition) || "top-center"
  );

  const handleSave = async () => {
    if (!restaurant?.id) return;
    
    setIsUpdating(true);
    try {
      const { error } = await supabase
        .from("restaurants")
        .update({ toast_position: selectedPosition })
        .eq("id", restaurant.id);

      if (error) throw error;

      await refreshProfile();
      toast.success("Toast position updated");
    } catch (error) {
      toast.error("Failed to update toast position");
    } finally {
      setIsUpdating(false);
    }
  };

  const handlePreview = () => {
    toast.success("This is how your notifications will appear!", {
      position: selectedPosition,
    });
  };

  return (
    <div className="p-5 rounded-lg border bg-card">
      <div className="flex items-start gap-4">
        <div className="p-2 rounded-md bg-accent text-accent-foreground">
          <Bell className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-4">
          <div>
            <h3 className="font-medium text-foreground">Notification Position</h3>
            <p className="text-sm text-muted-foreground">
              Choose where toast notifications appear on screen
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[180px]">
              <Label htmlFor="toast-position" className="sr-only">
                Toast Position
              </Label>
              <Select
                value={selectedPosition}
                onValueChange={(value) => setSelectedPosition(value as ToastPosition)}
              >
                <SelectTrigger id="toast-position" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOAST_POSITIONS.map((pos) => (
                    <SelectItem key={pos.value} value={pos.value}>
                      {pos.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handlePreview}
            >
              Preview
            </Button>

            <Button
              size="sm"
              onClick={handleSave}
              disabled={isUpdating || selectedPosition === restaurant?.toast_position}
            >
              {isUpdating ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
