import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Clock, Banknote, Settings2, Play, UserCheck, ChevronDown, Moon, Store } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

type ShiftMode = "pos_per_sale" | "shift_summary";

interface ShiftTemplate {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  auto_close_enabled: boolean;
  auto_close_time: string;
  default_closing_amount: number;
  default_float: number;
  auto_open_enabled: boolean;
  default_cashier_staff_id: string | null;
  shift_mode: ShiftMode;
}

const SHIFT_MODE_LABELS: Record<ShiftMode, { label: string; description: string }> = {
  pos_per_sale: { 
    label: "POS Per-Sale", 
    description: "Cashier records each sale individually" 
  },
  shift_summary: { 
    label: "Summary Only", 
    description: "Record shift-end totals only (no individual sales)" 
  },
};

interface Staff {
  id: string;
  name: string;
  user_id: string | null;
}

export function AutoShiftSettings() {
  const { restaurant, hasRole } = useAuth();
  const isOwner = hasRole("owner");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);

  useEffect(() => {
    if (restaurant?.id) {
      fetchData();
    }
  }, [restaurant?.id]);

  const fetchData = async () => {
    if (!restaurant?.id) return;

    setLoading(true);
    try {
      const [templatesRes, staffRes] = await Promise.all([
        supabase
          .from("shift_templates")
          .select("id, name, start_time, end_time, auto_close_enabled, auto_close_time, default_closing_amount, default_float, auto_open_enabled, default_cashier_staff_id, shift_mode")
          .eq("restaurant_id", restaurant.id)
          .order("start_time"),
        supabase
          .from("staff")
          .select("id, name, user_id")
          .eq("restaurant_id", restaurant.id)
          .eq("is_active", true)
          .order("name"),
      ]);

      if (templatesRes.error) throw templatesRes.error;

      setTemplates(
        (templatesRes.data || []).map((t: any) => ({
          ...t,
          auto_close_time: t.auto_close_time?.slice(0, 5) || "23:00",
          default_closing_amount: t.default_closing_amount || 0,
          default_float: t.default_float || 0,
          auto_open_enabled: t.auto_open_enabled || false,
          default_cashier_staff_id: t.default_cashier_staff_id || null,
          shift_mode: t.shift_mode || "pos_per_sale",
        }))
      );
      setStaff((staffRes.data as Staff[]) || []);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAutoClose = async (templateId: string, enabled: boolean) => {
    setSaving(templateId + "-close");
    try {
      const { error } = await supabase
        .from("shift_templates")
        .update({ auto_close_enabled: enabled })
        .eq("id", templateId);

      if (error) throw error;

      setTemplates((prev) =>
        prev.map((t) => (t.id === templateId ? { ...t, auto_close_enabled: enabled } : t))
      );
      toast.success(`Auto-close ${enabled ? "enabled" : "disabled"}`);
    } catch (error: any) {
      toast.error(error.message || "Failed to update");
    } finally {
      setSaving(null);
    }
  };

  const handleToggleAutoOpen = async (templateId: string, enabled: boolean) => {
    setSaving(templateId + "-open");
    try {
      const { error } = await supabase
        .from("shift_templates")
        .update({ auto_open_enabled: enabled })
        .eq("id", templateId);

      if (error) throw error;

      setTemplates((prev) =>
        prev.map((t) => (t.id === templateId ? { ...t, auto_open_enabled: enabled } : t))
      );
      toast.success(`Auto-open ${enabled ? "enabled" : "disabled"}`);
    } catch (error: any) {
      toast.error(error.message || "Failed to update");
    } finally {
      setSaving(null);
    }
  };

  const handleUpdateTemplate = async (template: ShiftTemplate) => {
    setSaving(template.id);
    try {
      const { error } = await supabase
        .from("shift_templates")
        .update({
          auto_close_time: template.auto_close_time + ":00",
          default_closing_amount: template.default_closing_amount,
          default_float: template.default_float,
          shift_mode: template.shift_mode,
        })
        .eq("id", template.id);

      if (error) throw error;

      toast.success("Template settings saved");
    } catch (error: any) {
      toast.error(error.message || "Failed to save");
    } finally {
      setSaving(null);
    }
  };

  const handleUpdateShiftMode = async (templateId: string, mode: ShiftMode) => {
    setSaving(templateId + "-mode");
    try {
      const { error } = await supabase
        .from("shift_templates")
        .update({ shift_mode: mode })
        .eq("id", templateId);

      if (error) throw error;

      setTemplates((prev) =>
        prev.map((t) => (t.id === templateId ? { ...t, shift_mode: mode } : t))
      );
      toast.success(`Shift mode updated to ${SHIFT_MODE_LABELS[mode].label}`);
    } catch (error: any) {
      toast.error(error.message || "Failed to update");
    } finally {
      setSaving(null);
    }
  };

  const handleUpdateTemplateCashier = async (templateId: string, staffId: string | null) => {
    setSaving(templateId + "-cashier");
    try {
      const { error } = await supabase
        .from("shift_templates")
        .update({ default_cashier_staff_id: staffId })
        .eq("id", templateId);

      if (error) throw error;

      setTemplates((prev) =>
        prev.map((t) =>
          t.id === templateId ? { ...t, default_cashier_staff_id: staffId } : t
        )
      );
      toast.success("Default cashier updated");
    } catch (error: any) {
      toast.error(error.message || "Failed to update");
    } finally {
      setSaving(null);
    }
  };

  const updateTemplate = (id: string, updates: Partial<ShiftTemplate>) => {
    setTemplates((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  };

  const getStaffName = (staffId: string | null) => {
    if (!staffId) return "Not set";
    const member = staff.find((s) => s.id === staffId);
    return member?.name || "Unknown";
  };

  if (!isOwner) {
    return null;
  }

  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <Collapsible defaultOpen={false} className="rounded-lg border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between p-5 hover:bg-accent/50 transition-colors rounded-lg">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-accent text-accent-foreground">
            <Settings2 className="h-5 w-5" />
          </div>
          <div className="text-left">
            <h3 className="font-medium text-foreground">Auto-Shift Settings</h3>
            <p className="text-sm text-muted-foreground">
              Configure automatic opening and closing for each shift template
            </p>
          </div>
        </div>
        <ChevronDown className="h-5 w-5 text-muted-foreground transition-transform duration-200 [[data-state=open]>div>&]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="animate-accordion-down">
        <div className="px-5 pb-5 pt-2">
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No shift templates found. Create shift templates first to configure auto-shift settings.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shift Template</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>
                      <Store className="h-4 w-4 inline mr-1" />
                      Sales Mode
                    </TableHead>
                    <TableHead>
                      <Play className="h-4 w-4 inline mr-1" />
                      Auto-Open
                    </TableHead>
                    <TableHead>
                      <UserCheck className="h-4 w-4 inline mr-1" />
                      Default Cashier
                    </TableHead>
                    <TableHead>
                      <Clock className="h-4 w-4 inline mr-1" />
                      Auto-Close
                    </TableHead>
                    <TableHead>Close Time</TableHead>
                    <TableHead>
                      <Banknote className="h-4 w-4 inline mr-1" />
                      Float / Close
                    </TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((template) => (
                    <TableRow key={template.id}>
                      <TableCell className="font-medium">{template.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {template.start_time?.slice(0, 5)} - {template.end_time?.slice(0, 5)}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={template.shift_mode}
                          onValueChange={(value) => handleUpdateShiftMode(template.id, value as ShiftMode)}
                          disabled={saving === template.id + "-mode"}
                        >
                          <SelectTrigger className="w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pos_per_sale">
                              <div className="flex items-center gap-2">
                                <Store className="h-3 w-3" />
                                POS Per-Sale
                              </div>
                            </SelectItem>
                            <SelectItem value="shift_summary">
                              <div className="flex items-center gap-2">
                                <Moon className="h-3 w-3" />
                                Summary Only
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={template.auto_open_enabled}
                          onCheckedChange={(checked) => handleToggleAutoOpen(template.id, checked)}
                          disabled={saving === template.id + "-open"}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={template.default_cashier_staff_id || "none"}
                          onValueChange={(value) =>
                            handleUpdateTemplateCashier(template.id, value === "none" ? null : value)
                          }
                          disabled={saving === template.id + "-cashier" || !template.auto_open_enabled}
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue placeholder="Select cashier" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No default</SelectItem>
                            {staff.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={template.auto_close_enabled}
                          onCheckedChange={(checked) => handleToggleAutoClose(template.id, checked)}
                          disabled={saving === template.id + "-close"}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          value={template.auto_close_time}
                          onChange={(e) =>
                            updateTemplate(template.id, { auto_close_time: e.target.value })
                          }
                          disabled={!template.auto_close_enabled}
                          className="w-28"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            value={template.default_float}
                            onChange={(e) =>
                              updateTemplate(template.id, {
                                default_float: Number(e.target.value),
                              })
                            }
                            placeholder="Float"
                            min={0}
                            step={50}
                            className="w-20"
                            title="Opening Float"
                          />
                          <Input
                            type="number"
                            value={template.default_closing_amount}
                            onChange={(e) =>
                              updateTemplate(template.id, {
                                default_closing_amount: Number(e.target.value),
                              })
                            }
                            placeholder="Close"
                            disabled={!template.auto_close_enabled}
                            min={0}
                            step={50}
                            className="w-20"
                            title="Closing Amount"
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleUpdateTemplate(template)}
                          disabled={saving === template.id}
                        >
                          {saving === template.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Save"
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-4">
            Auto-open will create shifts at template start time using the default cashier (from staff list) and float amount.
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
