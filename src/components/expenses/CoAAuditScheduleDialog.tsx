import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, Plus, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const DAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CoAAuditScheduleDialog({ open, onOpenChange }: Props) {
  const { profile, restaurant } = useAuth();
  const tenantId = profile?.tenant_id;
  const restaurantId = restaurant?.id;
  const queryClient = useQueryClient();

  const [enabled, setEnabled] = useState(false);
  const [dayOfWeek, setDayOfWeek] = useState<number>(1);
  const [sendTime, setSendTime] = useState<string>("09:00");
  const [includeOwnersManagers, setIncludeOwnersManagers] = useState(true);
  const [extraRecipients, setExtraRecipients] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");

  const { data: existing, isLoading } = useQuery({
    queryKey: ["coa-audit-schedule", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return null;
      const { data, error } = await (db as any)
        .from("coa_audit_schedules")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!restaurantId && open,
  });

  useEffect(() => {
    if (existing) {
      setEnabled(!!existing.enabled);
      setDayOfWeek(existing.day_of_week ?? 1);
      setSendTime((existing.send_time || "09:00:00").slice(0, 5));
      setIncludeOwnersManagers(existing.include_owners_managers ?? true);
      setExtraRecipients(existing.extra_recipients ?? []);
    } else if (open) {
      setEnabled(false);
      setDayOfWeek(1);
      setSendTime("09:00");
      setIncludeOwnersManagers(true);
      setExtraRecipients([]);
    }
  }, [existing, open]);

  const addRecipient = () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_RE.test(email)) {
      toast.error("Please enter a valid email address");
      return;
    }
    if (extraRecipients.includes(email)) {
      toast.error("This email is already in the list");
      return;
    }
    setExtraRecipients((prev) => [...prev, email]);
    setNewEmail("");
  };

  const removeRecipient = (email: string) => {
    setExtraRecipients((prev) => prev.filter((e) => e !== email));
  };

  const recipientsValid = useMemo(
    () => includeOwnersManagers || extraRecipients.length > 0,
    [includeOwnersManagers, extraRecipients]
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId || !restaurantId) throw new Error("Missing tenant or restaurant");
      const payload = {
        tenant_id: tenantId,
        restaurant_id: restaurantId,
        enabled,
        day_of_week: dayOfWeek,
        send_time: `${sendTime}:00`,
        include_owners_managers: includeOwnersManagers,
        extra_recipients: extraRecipients,
        created_by: profile?.id ?? null,
      };
      const { error } = await (db as any)
        .from("coa_audit_schedules")
        .upsert(payload, { onConflict: "restaurant_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        enabled ? "Weekly audit schedule saved" : "Schedule saved (currently disabled)"
      );
      queryClient.invalidateQueries({ queryKey: ["coa-audit-schedule", restaurantId] });
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast.error(e?.message || "Failed to save schedule");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Weekly CoA audit email
          </DialogTitle>
          <DialogDescription>
            Schedule a weekly summary of remaining mapping issues to be emailed to your team.
            The email will include a CSV link of unresolved issues.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading schedule…
          </div>
        ) : (
          <div className="space-y-5 py-2">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="schedule-enabled" className="text-sm font-medium cursor-pointer">
                  Enable weekly audit email
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sends a CoA mapping audit summary every week.
                </p>
              </div>
              <Switch
                id="schedule-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Day of week</Label>
                <Select
                  value={String(dayOfWeek)}
                  onValueChange={(v) => setDayOfWeek(parseInt(v, 10))}
                  disabled={!enabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS.map((d) => (
                      <SelectItem key={d.value} value={String(d.value)}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Time</Label>
                <Input
                  type="time"
                  value={sendTime}
                  onChange={(e) => setSendTime(e.target.value)}
                  disabled={!enabled}
                />
              </div>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="include-roles" className="text-sm font-medium cursor-pointer">
                    Include all owners & managers
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Auto-resolves recipients from team roles each week.
                  </p>
                </div>
                <Switch
                  id="include-roles"
                  checked={includeOwnersManagers}
                  onCheckedChange={setIncludeOwnersManagers}
                  disabled={!enabled}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Extra recipients</Label>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="name@example.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addRecipient();
                      }
                    }}
                    disabled={!enabled}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={addRecipient}
                    disabled={!enabled || !newEmail.trim()}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {extraRecipients.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {extraRecipients.map((email) => (
                      <Badge
                        key={email}
                        variant="secondary"
                        className="gap-1 pl-2 pr-1 py-0.5 font-normal"
                      >
                        {email}
                        <button
                          type="button"
                          onClick={() => removeRecipient(email)}
                          disabled={!enabled}
                          className="rounded hover:bg-muted-foreground/20 p-0.5 disabled:opacity-50"
                          aria-label={`Remove ${email}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No extra recipients added.
                  </p>
                )}
              </div>
            </div>

            {enabled && !recipientsValid && (
              <p className="text-xs text-destructive">
                Add at least one recipient - either enable owners & managers or add an email above.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={
              saveMutation.isPending ||
              isLoading ||
              (enabled && !recipientsValid)
            }
            className="gap-1.5"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CoAAuditScheduleDialog;