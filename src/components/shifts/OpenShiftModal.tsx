import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertCircle, Play } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShiftTemplate {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  default_float: number;
}

interface Drawer {
  id: string;
  name: string;
  is_active: boolean;
}

interface Staff {
  id: string;
  name: string;
  role: string;
  is_active: boolean;
}

interface OpenShiftModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShiftOpened: () => void;
}

const steps = [
  { id: 1, title: "Cashier" },
  { id: 2, title: "Template" },
  { id: 3, title: "Drawer" },
  { id: 4, title: "Float" },
];

export function OpenShiftModal({ open, onOpenChange, onShiftOpened }: OpenShiftModalProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [drawers, setDrawers] = useState<Drawer[]>([]);
  const [staffMembers, setStaffMembers] = useState<Staff[]>([]);
  const [conflictingShift, setConflictingShift] = useState<string | null>(null);

  const [selectedCashier, setSelectedCashier] = useState<string>("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [selectedDrawer, setSelectedDrawer] = useState<string>("");
  const [openingFloat, setOpeningFloat] = useState<number>(500);

  const { user, restaurant } = useAuth();

  useEffect(() => {
    if (open && restaurant) {
      loadData();
    }
  }, [open, restaurant]);

  useEffect(() => {
    // Update float when template changes
    const template = templates.find((t) => t.id === selectedTemplate);
    if (template) {
      setOpeningFloat(template.default_float);
    }
  }, [selectedTemplate, templates]);

  useEffect(() => {
    // Check for conflicting shifts when drawer changes
    if (selectedDrawer && restaurant) {
      checkConflictingShift();
    } else {
      setConflictingShift(null);
    }
  }, [selectedDrawer, restaurant]);

  const loadData = async () => {
    setLoadingData(true);
    try {
      const [templatesRes, drawersRes, staffRes] = await Promise.all([
        db
          .from("shift_templates")
          .select("*")
          .eq("restaurant_id", restaurant!.id)
          .order("name"),
        db
          .from("drawers")
          .select("*")
          .eq("restaurant_id", restaurant!.id)
          .eq("is_active", true)
          .order("name"),
        db
          .from("staff")
          .select("id, name, role, is_active")
          .eq("restaurant_id", restaurant!.id)
          .eq("is_active", true)
          .order("name"),
      ]);

      setTemplates((templatesRes.data as ShiftTemplate[]) || []);
      setDrawers((drawersRes.data as Drawer[]) || []);
      setStaffMembers((staffRes.data as Staff[]) || []);

      // Set defaults
      if (templatesRes.data?.length) {
        setSelectedTemplate(templatesRes.data[0].id);
      }
      if (drawersRes.data?.length) {
        setSelectedDrawer(drawersRes.data[0].id);
      }
      if (staffRes.data?.length) {
        setSelectedCashier(staffRes.data[0].id);
      }
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoadingData(false);
    }
  };

  const checkConflictingShift = async () => {
    const { data } = await db
      .from("shifts")
      .select("id, opened_at")
      .eq("drawer_id", selectedDrawer)
      .eq("status", "open")
      .maybeSingle();

    if (data) {
      setConflictingShift(data.id);
    } else {
      setConflictingShift(null);
    }
  };

  const handleOpenShift = async () => {
    if (!user || !restaurant) return;
    if (conflictingShift) {
      toast.error("This drawer already has an open shift");
      return;
    }
    if (!selectedCashier) {
      toast.error("Please select a cashier");
      return;
    }

    setLoading(true);
    try {
      const { error } = await db.from("shifts").insert({
        restaurant_id: restaurant.id,
        drawer_id: selectedDrawer,
        template_id: selectedTemplate || null,
        cashier_user_id: user.id,
        cashier_staff_id: selectedCashier,
        opening_float: openingFloat,
        status: "open",
      });

      if (error) throw error;

      toast.success("Shift opened successfully!");
      onShiftOpened();
      onOpenChange(false);
      resetForm();
    } catch (error: any) {
      toast.error(error.message || "Failed to open shift");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setCurrentStep(1);
    setSelectedCashier("");
    setSelectedTemplate("");
    setSelectedDrawer("");
    setOpeningFloat(500);
    setConflictingShift(null);
  };

  const canProceed = () => {
    if (currentStep === 1) return !!selectedCashier;
    if (currentStep === 2) return true; // Template is optional
    if (currentStep === 3) return selectedDrawer && !conflictingShift;
    if (currentStep === 4) return openingFloat >= 0;
    return false;
  };

  const selectedCashierName = staffMembers.find((s) => s.id === selectedCashier)?.name;
  const selectedTemplateName = templates.find((t) => t.id === selectedTemplate)?.name;
  const selectedDrawerName = drawers.find((d) => d.id === selectedDrawer)?.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        description={
          `Open a new cash drawer shift for ${new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}` +
          (selectedCashierName ? ` - cashier ${selectedCashierName}` : "") +
          (selectedDrawerName ? ` on ${selectedDrawerName}` : "") +
          "."
        }
        className="sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5 text-primary" />
            Open New Shift
          </DialogTitle>
        </DialogHeader>

        {loadingData ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Progress bar */}
            <div className="relative">
              <div className="flex justify-between mb-2">
                {steps.map((step) => (
                  <div
                    key={step.id}
                    className={cn(
                      "flex items-center gap-1.5 text-xs font-medium transition-colors",
                      currentStep >= step.id
                        ? "text-primary"
                        : "text-muted-foreground"
                    )}
                  >
                    <div
                      className={cn(
                        "w-5 h-5 rounded-full flex items-center justify-center text-[10px] transition-all",
                        currentStep > step.id
                          ? "bg-primary text-primary-foreground"
                          : currentStep === step.id
                          ? "bg-primary/10 text-primary border border-primary"
                          : "bg-accent text-muted-foreground"
                      )}
                    >
                      {currentStep > step.id ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        step.id
                      )}
                    </div>
                    <span className="hidden sm:inline">{step.title}</span>
                  </div>
                ))}
              </div>
              <div className="h-1 bg-accent rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
                />
              </div>
            </div>

            {/* Step content */}
            <div className="min-h-[160px]">
              {currentStep === 1 && (
                <div className="space-y-4 fade-slide-in">
                  <div className="space-y-2">
                    <Label>Cashier (Staff Member)</Label>
                    <Select value={selectedCashier} onValueChange={setSelectedCashier}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a cashier" />
                      </SelectTrigger>
                      <SelectContent>
                        {staffMembers.map((staff) => (
                          <SelectItem key={staff.id} value={staff.id}>
                            <div className="flex flex-col">
                              <span>{staff.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {staff.role}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Select the staff member operating this shift
                    </p>
                  </div>
                </div>
              )}

              {currentStep === 2 && (
                <div className="space-y-4 fade-slide-in">
                  <div className="space-y-2">
                    <Label>Shift template (optional)</Label>
                    <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a template" />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            <div className="flex flex-col">
                              <span>{template.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {template.start_time} - {template.end_time}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Templates help pre-fill shift settings
                    </p>
                  </div>
                </div>
              )}

              {currentStep === 3 && (
                <div className="space-y-4 fade-slide-in">
                  <div className="space-y-2">
                    <Label>Cash drawer</Label>
                    <Select value={selectedDrawer} onValueChange={setSelectedDrawer}>
                      <SelectTrigger className={conflictingShift ? "border-destructive" : ""}>
                        <SelectValue placeholder="Select a drawer" />
                      </SelectTrigger>
                      <SelectContent>
                        {drawers.map((drawer) => (
                          <SelectItem key={drawer.id} value={drawer.id}>
                            {drawer.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {conflictingShift && (
                      <div className="flex items-center gap-2 text-xs text-destructive animate-shake-error">
                        <AlertCircle className="h-3 w-3" />
                        <span>This drawer already has an open shift</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {currentStep === 4 && (
                <div className="space-y-4 fade-slide-in">
                  <div className="space-y-2">
                    <Label>Opening float</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                        SAR
                      </span>
                      <Input
                        type="number"
                        value={openingFloat}
                        onChange={(e) => setOpeningFloat(Number(e.target.value))}
                        className="pl-12 text-lg font-medium"
                        min={0}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      The starting cash amount in the drawer
                    </p>
                  </div>

                  {/* Summary */}
                  <div className="p-4 bg-accent/50 rounded-lg space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cashier</span>
                      <span className="font-medium">{selectedCashierName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Template</span>
                      <span className="font-medium">{selectedTemplateName || "None"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Drawer</span>
                      <span className="font-medium">{selectedDrawerName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Float</span>
                      <span className="font-medium">SAR {openingFloat.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              {currentStep > 1 && (
                <Button
                  variant="outline"
                  onClick={() => setCurrentStep((s) => s - 1)}
                  disabled={loading}
                >
                  Back
                </Button>
              )}
              <Button
                className="flex-1"
                onClick={() => {
                  if (currentStep < 4) {
                    setCurrentStep((s) => s + 1);
                  } else {
                    handleOpenShift();
                  }
                }}
                disabled={!canProceed() || loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : currentStep < 4 ? (
                  "Continue"
                ) : (
                  "Open Shift"
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
