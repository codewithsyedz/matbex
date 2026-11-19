import { useState, useEffect } from "react";
import { Settings, Save, Loader2, Mail, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";

interface InventorySettingsData {
  id?: string;
  costing_method: string;
  expiry_alert_days: number;
  expiry_alert_enabled: boolean;
  expiry_alert_email: string;
}

export function InventorySettings() {
  const { restaurant, isManager } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<InventorySettingsData>({
    costing_method: "fifo",
    expiry_alert_days: 7,
    expiry_alert_enabled: true,
    expiry_alert_email: "",
  });

  useEffect(() => {
    if (restaurant?.id) {
      fetchSettings();
    }
  }, [restaurant?.id]);

  const fetchSettings = async () => {
    if (!restaurant?.id) return;
    
    try {
      const { data, error } = await db
        .from("inventory_settings")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .maybeSingle();

      if (error) throw error;
      
      if (data) {
        setSettings({
          id: data.id,
          costing_method: data.costing_method,
          expiry_alert_days: data.expiry_alert_days,
          expiry_alert_enabled: data.expiry_alert_enabled,
          expiry_alert_email: data.expiry_alert_email || "",
        });
      }
    } catch (error) {
      console.error("Error fetching inventory settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!restaurant?.id || !isManager) return;
    
    setSaving(true);
    try {
      const settingsData = {
        restaurant_id: restaurant.id,
        costing_method: settings.costing_method,
        expiry_alert_days: settings.expiry_alert_days,
        expiry_alert_enabled: settings.expiry_alert_enabled,
        expiry_alert_email: settings.expiry_alert_email || null,
      };

      if (settings.id) {
        const { error } = await db
          .from("inventory_settings")
          .update(settingsData)
          .eq("id", settings.id);

        if (error) throw error;
      } else {
        const { error } = await db
          .from("inventory_settings")
          .insert(settingsData);

        if (error) throw error;
      }

      toast({ title: "Settings saved" });
      fetchSettings();
    } catch (error: any) {
      console.error("Error saving settings:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const sendTestAlert = async () => {
    if (!restaurant?.id || !settings.expiry_alert_email) {
      toast({ title: "Error", description: "Please enter an email address first", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await db.functions.invoke("send-expiry-alerts", {
        body: { restaurant_id: restaurant.id, test: true },
      });

      if (error) throw error;
      toast({ title: "Alert check triggered", description: "Check your email for any expiring items" });
    } catch (error: any) {
      console.error("Error sending test alert:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Inventory Settings
        </CardTitle>
        <CardDescription>Configure costing methods and expiry alerts</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Costing Method */}
        <div className="space-y-3">
          <div>
            <Label className="text-base font-medium">Inventory Costing Method</Label>
            <p className="text-sm text-muted-foreground mt-1">
              How inventory costs are calculated when items are used
            </p>
          </div>
          <Select 
            value={settings.costing_method} 
            onValueChange={(v) => setSettings(s => ({ ...s, costing_method: v }))}
            disabled={!isManager}
          >
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fifo">
                <div className="flex flex-col items-start">
                  <span className="font-medium">FIFO (First In, First Out)</span>
                  <span className="text-xs text-muted-foreground">Oldest inventory is used first</span>
                </div>
              </SelectItem>
              <SelectItem value="lifo">
                <div className="flex flex-col items-start">
                  <span className="font-medium">LIFO (Last In, First Out)</span>
                  <span className="text-xs text-muted-foreground">Newest inventory is used first</span>
                </div>
              </SelectItem>
              <SelectItem value="average">
                <div className="flex flex-col items-start">
                  <span className="font-medium">Weighted Average</span>
                  <span className="text-xs text-muted-foreground">Average cost of all batches</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="border-t pt-6">
          {/* Expiry Alerts */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Expiry Alerts
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Get notified when inventory batches are near expiration
                </p>
              </div>
              <Switch
                checked={settings.expiry_alert_enabled}
                onCheckedChange={(checked) => setSettings(s => ({ ...s, expiry_alert_enabled: checked }))}
                disabled={!isManager}
              />
            </div>

            {settings.expiry_alert_enabled && (
              <div className="space-y-4 pl-6 border-l-2 border-muted">
                <div className="space-y-2">
                  <Label>Alert Email Address</Label>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="alerts@yourrestaurant.com"
                      value={settings.expiry_alert_email}
                      onChange={(e) => setSettings(s => ({ ...s, expiry_alert_email: e.target.value }))}
                      className="max-w-sm"
                      disabled={!isManager}
                    />
                    <Button 
                      variant="outline" 
                      size="icon"
                      onClick={sendTestAlert}
                      disabled={saving || !settings.expiry_alert_email}
                      title="Send test alert"
                    >
                      <Mail className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Daily alerts will be sent to this email
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Alert Window (days before expiry)</Label>
                  <Select 
                    value={settings.expiry_alert_days.toString()} 
                    onValueChange={(v) => setSettings(s => ({ ...s, expiry_alert_days: parseInt(v) }))}
                    disabled={!isManager}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">3 days</SelectItem>
                      <SelectItem value="5">5 days</SelectItem>
                      <SelectItem value="7">7 days</SelectItem>
                      <SelectItem value="14">14 days</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        </div>

        {isManager && (
          <div className="pt-4 border-t">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Settings
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
