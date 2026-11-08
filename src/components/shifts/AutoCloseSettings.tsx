import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Clock, Banknote, Settings2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ShiftTemplate {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  auto_close_enabled: boolean;
  auto_close_time: string;
  default_closing_amount: number;
}

export function AutoCloseSettings() {
  const { restaurant, hasRole } = useAuth();
  const isOwner = hasRole("owner");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);

  useEffect(() => {
    if (restaurant?.id) {
      fetchTemplates();
    }
  }, [restaurant?.id]);

  const fetchTemplates = async () => {
    if (!restaurant?.id) return;

    setLoading(true);
    try {
      const { data, error } = await db
        .from("shift_templates")
        .select("id, name, start_time, end_time, auto_close_enabled, auto_close_time, default_closing_amount")
        .eq("restaurant_id", restaurant.id)
        .order("start_time");

      if (error) throw error;

      setTemplates(
        (data || []).map((t) => ({
          ...t,
          auto_close_time: t.auto_close_time?.slice(0, 5) || "23:00",
          default_closing_amount: t.default_closing_amount || 0,
        }))
      );
    } catch (error) {
      console.error("Error fetching shift templates:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (templateId: string, enabled: boolean) => {
    setSaving(templateId);
    try {
      const { error } = await db
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

  const handleUpdate = async (template: ShiftTemplate) => {
    setSaving(template.id);
    try {
      const { error } = await db
        .from("shift_templates")
        .update({
          auto_close_time: template.auto_close_time + ":00",
          default_closing_amount: template.default_closing_amount,
        })
        .eq("id", template.id);

      if (error) throw error;

      toast.success("Settings saved");
    } catch (error: any) {
      toast.error(error.message || "Failed to save");
    } finally {
      setSaving(null);
    }
  };

  const updateTemplate = (id: string, updates: Partial<ShiftTemplate>) => {
    setTemplates((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  };

  if (!isOwner) {
    return null;
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (templates.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Auto-Close Shifts
          </CardTitle>
          <CardDescription>
            Configure automatic shift closing per shift template
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No shift templates found. Create shift templates first to configure auto-close times.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Settings2 className="h-5 w-5" />
          Auto-Close Shifts
        </CardTitle>
        <CardDescription>
          Configure automatic closing time for each shift template
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Shift Template</TableHead>
              <TableHead>Hours</TableHead>
              <TableHead>Auto-Close</TableHead>
              <TableHead>
                <Clock className="h-4 w-4 inline mr-1" />
                Close Time
              </TableHead>
              <TableHead>
                <Banknote className="h-4 w-4 inline mr-1" />
                Default Amount
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
                  <Switch
                    checked={template.auto_close_enabled}
                    onCheckedChange={(checked) => handleToggle(template.id, checked)}
                    disabled={saving === template.id}
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
                  <Input
                    type="number"
                    value={template.default_closing_amount}
                    onChange={(e) =>
                      updateTemplate(template.id, {
                        default_closing_amount: Number(e.target.value),
                      })
                    }
                    disabled={!template.auto_close_enabled}
                    min={0}
                    step={50}
                    className="w-24"
                  />
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleUpdate(template)}
                    disabled={saving === template.id || !template.auto_close_enabled}
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
        <p className="text-xs text-muted-foreground mt-4">
          Each shift template can have its own auto-close time. Shifts will close at the specified time in your restaurant's timezone.
        </p>
      </CardContent>
    </Card>
  );
}
