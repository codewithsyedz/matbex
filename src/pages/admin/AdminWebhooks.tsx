import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";
import { Webhook, Plus, MoreHorizontal, Trash2, Edit, CheckCircle, XCircle, Play } from "lucide-react";
import { format } from "date-fns";

interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  events: string[];
  secret: string | null;
  is_active: boolean;
  created_at: string;
}

interface WebhookDelivery {
  id: string;
  webhook_config_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  response_status: number;
  response_body: string;
  delivered_at: string;
  success: boolean;
}

const AVAILABLE_EVENTS = [
  { value: "trial.expiring_soon", label: "Trial Expiring Soon (3 days)" },
  { value: "trial.expiring_tomorrow", label: "Trial Expiring Tomorrow" },
  { value: "tenant.status_changed", label: "Tenant Status Changed" },
  { value: "tenant.plan_changed", label: "Tenant Plan Changed" },
  { value: "trial.*", label: "All Trial Events" },
  { value: "tenant.*", label: "All Tenant Events" },
];

export default function AdminWebhooks() {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<WebhookConfig | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    url: "",
    secret: "",
    events: [] as string[],
    is_active: true,
  });
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    try {
      const [{ data: webhooksData }, { data: deliveriesData }] = await Promise.all([
        db
          .from("webhook_configs")
          .select("*")
          .order("created_at", { ascending: false }),
        db
          .from("webhook_deliveries")
          .select("*")
          .order("delivered_at", { ascending: false })
          .limit(50),
      ]);

      setWebhooks(webhooksData || []);
      setDeliveries((deliveriesData || []).map(d => ({
        ...d,
        payload: d.payload as Record<string, unknown>
      })));
    } catch (error) {
      console.error("Error fetching webhooks:", error);
      toast.error("Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenDialog = (webhook?: WebhookConfig) => {
    if (webhook) {
      setEditingWebhook(webhook);
      setFormData({
        name: webhook.name,
        url: webhook.url,
        secret: webhook.secret || "",
        events: webhook.events,
        is_active: webhook.is_active,
      });
    } else {
      setEditingWebhook(null);
      setFormData({
        name: "",
        url: "",
        secret: "",
        events: [],
        is_active: true,
      });
    }
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.url || formData.events.length === 0) {
      toast.error("Please fill in all required fields");
      return;
    }

    setSaving(true);

    try {
      if (editingWebhook) {
        const { error } = await db
          .from("webhook_configs")
          .update({
            name: formData.name,
            url: formData.url,
            secret: formData.secret || null,
            events: formData.events,
            is_active: formData.is_active,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingWebhook.id);

        if (error) throw error;
        toast.success("Webhook updated");
      } else {
        const { error } = await db.from("webhook_configs").insert({
          name: formData.name,
          url: formData.url,
          secret: formData.secret || null,
          events: formData.events,
          is_active: formData.is_active,
        });

        if (error) throw error;
        toast.success("Webhook created");
      }

      setDialogOpen(false);
      fetchData();
    } catch (error) {
      console.error("Error saving webhook:", error);
      toast.error("Failed to save webhook");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (webhook: WebhookConfig) => {
    try {
      const { error } = await db.from("webhook_configs").delete().eq("id", webhook.id);
      if (error) throw error;
      toast.success("Webhook deleted");
      fetchData();
    } catch (error) {
      console.error("Error deleting webhook:", error);
      toast.error("Failed to delete webhook");
    }
  };

  const handleToggle = async (webhook: WebhookConfig) => {
    try {
      const { error } = await db
        .from("webhook_configs")
        .update({ is_active: !webhook.is_active })
        .eq("id", webhook.id);

      if (error) throw error;
      toast.success(`Webhook ${webhook.is_active ? "disabled" : "enabled"}`);
      fetchData();
    } catch (error) {
      console.error("Error toggling webhook:", error);
      toast.error("Failed to update webhook");
    }
  };

  const handleTestWebhook = async () => {
    try {
      const response = await db.functions.invoke("send-webhook-notifications");
      if (response.error) throw response.error;
      toast.success("Webhook check triggered");
      setTimeout(fetchData, 2000);
    } catch (error) {
      console.error("Error triggering webhooks:", error);
      toast.error("Failed to trigger webhooks");
    }
  };

  const toggleEvent = (event: string) => {
    setFormData((prev) => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter((e) => e !== event)
        : [...prev.events, event],
    }));
  };

  const getWebhookName = (configId: string) => {
    return webhooks.find((w) => w.id === configId)?.name || "Unknown";
  };

  return (
    <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Webhook Notifications
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Configure webhooks for trial expiration and status change alerts.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleTestWebhook}>
              <Play className="h-4 w-4 mr-2" />
              Run Check
            </Button>
            <Button onClick={() => handleOpenDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              Add Webhook
            </Button>
          </div>
        </div>

        {/* Webhooks List */}
        <Card className="border-border/40">
          <CardHeader>
            <CardTitle className="text-lg font-medium">Configured Webhooks</CardTitle>
            <CardDescription>{webhooks.length} webhooks</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : webhooks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No webhooks configured
                    </TableCell>
                  </TableRow>
                ) : (
                  webhooks.map((webhook) => (
                    <TableRow key={webhook.id}>
                      <TableCell className="font-medium">{webhook.name}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs max-w-48 truncate">
                        {webhook.url}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {webhook.events.map((event) => (
                            <Badge key={event} variant="secondary" className="text-xs">
                              {event}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={webhook.is_active ? "default" : "outline"}>
                          {webhook.is_active ? "Active" : "Disabled"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleOpenDialog(webhook)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleToggle(webhook)}>
                              {webhook.is_active ? "Disable" : "Enable"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleDelete(webhook)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Recent Deliveries */}
        <Card className="border-border/40">
          <CardHeader>
            <CardTitle className="text-lg font-medium">Recent Deliveries</CardTitle>
            <CardDescription>Last 50 webhook delivery attempts</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Webhook</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Response</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No deliveries yet
                    </TableCell>
                  </TableRow>
                ) : (
                  deliveries.map((delivery) => (
                    <TableRow key={delivery.id}>
                      <TableCell className="font-medium">
                        {getWebhookName(delivery.webhook_config_id)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {delivery.event_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {delivery.success ? (
                          <div className="flex items-center gap-1 text-green-600">
                            <CheckCircle className="h-4 w-4" />
                            <span>{delivery.response_status}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-destructive">
                            <XCircle className="h-4 w-4" />
                            <span>{delivery.response_status || "Failed"}</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs max-w-32 truncate">
                        {delivery.response_body || "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(delivery.delivered_at), "MMM d, HH:mm")}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingWebhook ? "Edit Webhook" : "Add Webhook"}</DialogTitle>
              <DialogDescription>
                Configure webhook URL and events to receive notifications.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My Webhook"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="url">URL</Label>
                <Input
                  id="url"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  placeholder="https://example.com/webhook"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="secret">Secret (optional)</Label>
                <Input
                  id="secret"
                  type="password"
                  value={formData.secret}
                  onChange={(e) => setFormData({ ...formData, secret: e.target.value })}
                  placeholder="Signing secret for HMAC verification"
                />
              </div>
              <div className="space-y-2">
                <Label>Events</Label>
                <div className="space-y-2">
                  {AVAILABLE_EVENTS.map((event) => (
                    <div key={event.value} className="flex items-center space-x-2">
                      <Checkbox
                        id={event.value}
                        checked={formData.events.includes(event.value)}
                        onCheckedChange={() => toggleEvent(event.value)}
                      />
                      <Label htmlFor={event.value} className="text-sm font-normal cursor-pointer">
                        {event.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
                <Label htmlFor="active">Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : editingWebhook ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
  );
}
