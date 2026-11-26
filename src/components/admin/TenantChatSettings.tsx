import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Pencil, Trash2, Clock, Loader2, Power } from "lucide-react";

interface ChatSettings {
  id?: string;
  tenant_id: string;
  chat_enabled: boolean;
  allow_message_edit: boolean;
  allow_message_delete: boolean;
  edit_window_minutes: number | null;
  delete_window_minutes: number | null;
}

interface TenantChatSettingsProps {
  tenantId: string;
}

const TIME_OPTIONS = [
  { value: "5", label: "5 minutes" },
  { value: "10", label: "10 minutes" },
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "unlimited", label: "Unlimited" },
];

export function TenantChatSettings({ tenantId }: TenantChatSettingsProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<Omit<ChatSettings, "id" | "tenant_id">>({
    chat_enabled: true,
    allow_message_edit: true,
    allow_message_delete: true,
    edit_window_minutes: 15,
    delete_window_minutes: 5,
  });

  const { data: settings, isLoading } = useQuery({
    queryKey: ["admin-chat-settings", tenantId],
    queryFn: async () => {
      const { data, error } = await (db
        .from("chat_settings" as any)
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle() as any);

      if (error) throw error;
      return data as ChatSettings | null;
    },
    enabled: !!tenantId,
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        chat_enabled: settings.chat_enabled ?? true,
        allow_message_edit: settings.allow_message_edit,
        allow_message_delete: settings.allow_message_delete,
        edit_window_minutes: settings.edit_window_minutes,
        delete_window_minutes: settings.delete_window_minutes,
      });
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: async (updates: Omit<ChatSettings, "id" | "tenant_id">) => {
      // Check if settings exist
      const { data: existing } = await (db
        .from("chat_settings" as any)
        .select("id")
        .eq("tenant_id", tenantId)
        .maybeSingle() as any);

      if (existing) {
        const { data, error } = await (db
          .from("chat_settings" as any)
          .update(updates)
          .eq("tenant_id", tenantId)
          .select()
          .single() as any);

        if (error) throw error;
        return data;
      } else {
        const { data, error } = await (db
          .from("chat_settings" as any)
          .insert({ tenant_id: tenantId, ...updates })
          .select()
          .single() as any);

        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-chat-settings", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["chat-settings", tenantId] });
      toast.success("Chat settings updated");
    },
    onError: (error: any) => {
      toast.error("Failed to update settings", { description: error.message });
    },
  });

  const handleSave = () => {
    updateMutation.mutate(formData);
  };

  const getTimeValue = (minutes: number | null): string => {
    if (minutes === null) return "unlimited";
    return minutes.toString();
  };

  const parseTimeValue = (value: string): number | null => {
    if (value === "unlimited") return null;
    return parseInt(value, 10);
  };

  if (isLoading) {
    return (
      <Card className="border-border/40">
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <CardTitle className="text-base font-medium">Chat Module Settings</CardTitle>
        </div>
        <CardDescription>
          Configure message editing and deletion permissions for this tenant's chat
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Chat Module Toggle */}
        <div className="space-y-4 rounded-lg border p-4 bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Power className="h-4 w-4 text-muted-foreground" />
                <Label className="font-medium">Chat Module Enabled</Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Enable or disable the chat module for this tenant
              </p>
            </div>
            <Switch
              checked={formData.chat_enabled}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, chat_enabled: checked })
              }
            />
          </div>
          {!formData.chat_enabled && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              When disabled, the chat feature will be hidden from all users in this tenant.
            </p>
          )}
        </div>

        {/* Message Editing */}
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Pencil className="h-4 w-4 text-muted-foreground" />
                <Label className="font-medium">Allow Message Editing</Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Users can edit their sent messages
              </p>
            </div>
            <Switch
              checked={formData.allow_message_edit}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, allow_message_edit: checked })
              }
            />
          </div>

          {formData.allow_message_edit && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <Label>Edit Window</Label>
              </div>
              <Select
                value={getTimeValue(formData.edit_window_minutes)}
                onValueChange={(v) =>
                  setFormData({ ...formData, edit_window_minutes: parseTimeValue(v) })
                }
              >
                <SelectTrigger className="w-full max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Time limit for users to edit their messages after sending
              </p>
            </div>
          )}
        </div>

        {/* Message Deletion */}
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-muted-foreground" />
                <Label className="font-medium">Allow Message Deletion</Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Users can delete their sent messages
              </p>
            </div>
            <Switch
              checked={formData.allow_message_delete}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, allow_message_delete: checked })
              }
            />
          </div>

          {formData.allow_message_delete && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <Label>Delete Window</Label>
              </div>
              <Select
                value={getTimeValue(formData.delete_window_minutes)}
                onValueChange={(v) =>
                  setFormData({ ...formData, delete_window_minutes: parseTimeValue(v) })
                }
              >
                <SelectTrigger className="w-full max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Time limit for users to delete their messages after sending
              </p>
            </div>
          )}
        </div>

        <Button onClick={handleSave} disabled={updateMutation.isPending}>
          {updateMutation.isPending && (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          )}
          Save Chat Settings
        </Button>
      </CardContent>
    </Card>
  );
}
