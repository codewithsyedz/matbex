import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, MessageSquare } from "lucide-react";

interface GlobalChatDefaults {
  id: string;
  chat_enabled_default: boolean;
  allow_message_edit_default: boolean;
  allow_message_delete_default: boolean;
  edit_window_minutes_default: number | null;
  delete_window_minutes_default: number | null;
}

const TIME_WINDOWS = [
  { value: "5", label: "5 minutes" },
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "unlimited", label: "Unlimited" },
];

export function GlobalChatSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<Partial<GlobalChatDefaults>>({});

  const { data: defaults, isLoading } = useQuery({
    queryKey: ["global-chat-defaults"],
    queryFn: async () => {
      const { data, error } = await db
        .from("global_chat_defaults")
        .select("*")
        .single();
      
      if (error) throw error;
      return data as GlobalChatDefaults;
    },
  });

  useEffect(() => {
    if (defaults) {
      setFormData(defaults);
    }
  }, [defaults]);

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<GlobalChatDefaults>) => {
      if (!defaults?.id) throw new Error("No defaults found");
      
      const { error } = await db
        .from("global_chat_defaults")
        .update(updates)
        .eq("id", defaults.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["global-chat-defaults"] });
      toast({ title: "Global chat defaults updated" });
    },
    onError: (error) => {
      toast({ 
        title: "Error updating defaults", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  const handleSave = () => {
    updateMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <Card className="border-border/40">
        <CardContent className="pt-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <CardTitle className="text-base font-medium">Global Chat Defaults</CardTitle>
        </div>
        <CardDescription>
          Default settings applied to all new tenants. Existing tenants keep their current settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Chat Enabled by Default</Label>
            <p className="text-sm text-muted-foreground">
              New tenants will have chat module enabled
            </p>
          </div>
          <Switch
            checked={formData.chat_enabled_default ?? true}
            onCheckedChange={(checked) => 
              setFormData({ ...formData, chat_enabled_default: checked })
            }
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Allow Message Editing</Label>
            <p className="text-sm text-muted-foreground">
              Users can edit their messages
            </p>
          </div>
          <Switch
            checked={formData.allow_message_edit_default ?? true}
            onCheckedChange={(checked) => 
              setFormData({ ...formData, allow_message_edit_default: checked })
            }
          />
        </div>

        {formData.allow_message_edit_default && (
          <div className="ml-4 flex items-center justify-between">
            <Label>Edit Time Window</Label>
            <Select
              value={formData.edit_window_minutes_default?.toString() || "unlimited"}
              onValueChange={(value) => 
                setFormData({ 
                  ...formData, 
                  edit_window_minutes_default: value === "unlimited" ? null : parseInt(value) 
                })
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_WINDOWS.map((tw) => (
                  <SelectItem key={tw.value} value={tw.value}>
                    {tw.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Allow Message Deletion</Label>
            <p className="text-sm text-muted-foreground">
              Users can delete their messages
            </p>
          </div>
          <Switch
            checked={formData.allow_message_delete_default ?? true}
            onCheckedChange={(checked) => 
              setFormData({ ...formData, allow_message_delete_default: checked })
            }
          />
        </div>

        {formData.allow_message_delete_default && (
          <div className="ml-4 flex items-center justify-between">
            <Label>Delete Time Window</Label>
            <Select
              value={formData.delete_window_minutes_default?.toString() || "unlimited"}
              onValueChange={(value) => 
                setFormData({ 
                  ...formData, 
                  delete_window_minutes_default: value === "unlimited" ? null : parseInt(value) 
                })
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_WINDOWS.map((tw) => (
                  <SelectItem key={tw.value} value={tw.value}>
                    {tw.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="pt-4 border-t border-border/40">
          <Button 
            onClick={handleSave} 
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
