import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sparkles,
  Plus,
  Pencil,
  Trash2,
  ImageIcon,
  Clock,
  Calendar,
} from "lucide-react";
import {
  useCFDIdleAdmin,
  filterActivePromos,
  type CFDPromo,
} from "@/hooks/useCFD";
import { toast } from "sonner";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface PromoFormState {
  id?: string;
  title: string;
  body: string;
  image_url: string;
  accent_color: string;
  starts_on: string;
  ends_on: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  sort_order: number;
  is_active: boolean;
}

const EMPTY_PROMO: PromoFormState = {
  title: "",
  body: "",
  image_url: "",
  accent_color: "",
  starts_on: "",
  ends_on: "",
  days_of_week: [],
  start_time: "",
  end_time: "",
  sort_order: 0,
  is_active: true,
};

function fromPromo(p: CFDPromo): PromoFormState {
  return {
    id: p.id,
    title: p.title,
    body: p.body ?? "",
    image_url: p.image_url ?? "",
    accent_color: p.accent_color ?? "",
    starts_on: p.starts_on ?? "",
    ends_on: p.ends_on ?? "",
    days_of_week: p.days_of_week ?? [],
    start_time: p.start_time ? p.start_time.slice(0, 5) : "",
    end_time: p.end_time ? p.end_time.slice(0, 5) : "",
    sort_order: p.sort_order,
    is_active: p.is_active,
  };
}

function toPayload(s: PromoFormState) {
  return {
    id: s.id,
    title: s.title.trim(),
    body: s.body.trim() || null,
    image_url: s.image_url.trim() || null,
    accent_color: s.accent_color.trim() || null,
    starts_on: s.starts_on || null,
    ends_on: s.ends_on || null,
    days_of_week: s.days_of_week.length ? s.days_of_week : null,
    start_time: s.start_time ? `${s.start_time}:00` : null,
    end_time: s.end_time ? `${s.end_time}:00` : null,
    sort_order: Number.isFinite(s.sort_order) ? s.sort_order : 0,
    is_active: s.is_active,
  };
}

function scheduleSummary(p: CFDPromo): string {
  const parts: string[] = [];
  if (p.starts_on || p.ends_on) {
    parts.push(`${p.starts_on ?? "…"} → ${p.ends_on ?? "…"}`);
  }
  if (p.days_of_week && p.days_of_week.length) {
    parts.push(p.days_of_week.map((d) => DAYS[d]).join(" "));
  }
  if (p.start_time || p.end_time) {
    parts.push(`${(p.start_time ?? "00:00").slice(0, 5)}–${(p.end_time ?? "23:59").slice(0, 5)}`);
  }
  return parts.length ? parts.join(" · ") : "Always on";
}

export function CFDIdleScreenManager() {
  const {
    settings,
    promos,
    isLoading,
    saveSettings,
    upsertPromo,
    deletePromo,
  } = useCFDIdleAdmin();

  const [heading, setHeading] = useState("");
  const [subheading, setSubheading] = useState("");
  const [showLogo, setShowLogo] = useState(true);
  const [rotation, setRotation] = useState(8);
  const [savingSettings, setSavingSettings] = useState(false);

  const [editing, setEditing] = useState<PromoFormState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setHeading(settings.heading ?? "");
    setSubheading(settings.subheading ?? "");
    setShowLogo(!!settings.show_logo);
    setRotation(settings.rotation_seconds ?? 8);
  }, [settings]);

  const onSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await saveSettings({
        heading: heading.trim() || null,
        subheading: subheading.trim() || null,
        show_logo: showLogo,
        rotation_seconds: Math.min(120, Math.max(3, Number(rotation) || 8)),
      });
      toast.success("Idle screen updated");
    } catch (err: any) {
      toast.error(err?.message || "Could not save idle screen");
    } finally {
      setSavingSettings(false);
    }
  };

  const onSavePromo = async () => {
    if (!editing) return;
    if (!editing.title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    try {
      await upsertPromo(toPayload(editing));
      toast.success(editing.id ? "Promo updated" : "Promo added");
      setEditing(null);
    } catch (err: any) {
      toast.error(err?.message || "Could not save promo");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (p: CFDPromo) => {
    if (!confirm(`Delete "${p.title}"?`)) return;
    try {
      await deletePromo(p.id);
      toast.success("Promo deleted");
    } catch (err: any) {
      toast.error(err?.message || "Could not delete promo");
    }
  };

  const toggleDay = (d: number) => {
    if (!editing) return;
    const has = editing.days_of_week.includes(d);
    setEditing({
      ...editing,
      days_of_week: has
        ? editing.days_of_week.filter((x) => x !== d)
        : [...editing.days_of_week, d].sort(),
    });
  };

  const activeNow = filterActivePromos(promos);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <CardTitle className="text-base font-medium">CFD Idle Screen & Promotions</CardTitle>
            <CardDescription>
              Customize what customers see when no order is in progress, and rotate scheduled promotions.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-8">
        {/* Idle screen */}
        <section className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cfd-heading">Heading</Label>
              <Input
                id="cfd-heading"
                placeholder={settings?.heading || "Welcome"}
                value={heading}
                onChange={(e) => setHeading(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfd-subheading">Subheading</Label>
              <Input
                id="cfd-subheading"
                placeholder="أهلاً وسهلاً · Welcome"
                value={subheading}
                onChange={(e) => setSubheading(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfd-rotation">Promo rotation (seconds)</Label>
              <Input
                id="cfd-rotation"
                type="number"
                min={3}
                max={120}
                value={rotation}
                onChange={(e) => setRotation(Number(e.target.value))}
              />
            </div>
            <div className="flex items-end justify-between pb-1">
              <div>
                <Label htmlFor="cfd-show-logo">Show logo</Label>
                <p className="text-xs text-muted-foreground">From restaurant branding</p>
              </div>
              <Switch id="cfd-show-logo" checked={showLogo} onCheckedChange={setShowLogo} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={onSaveSettings} disabled={savingSettings || isLoading}>
              Save idle screen
            </Button>
          </div>
        </section>

        {/* Promos */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Promotions</div>
              <p className="text-sm text-muted-foreground">
                {activeNow.length} of {promos.length} active right now.
              </p>
            </div>
            <Button onClick={() => setEditing({ ...EMPTY_PROMO })}>
              <Plus className="h-4 w-4 mr-1.5" />
              New promo
            </Button>
          </div>

          {promos.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-lg">
              No promotions yet — the idle screen will show only branding.
            </div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {promos.map((p) => {
                const live = activeNow.some((a) => a.id === p.id);
                return (
                  <li key={p.id} className="flex items-start gap-3 p-3">
                    <div
                      className="h-12 w-12 rounded-md bg-muted flex items-center justify-center overflow-hidden shrink-0"
                      style={
                        p.accent_color
                          ? { background: p.accent_color, color: "white" }
                          : undefined
                      }
                    >
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt={p.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ImageIcon className="h-5 w-5 opacity-60" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{p.title}</span>
                        {live && (
                          <Badge variant="default" className="h-5">
                            Live
                          </Badge>
                        )}
                        {!p.is_active && (
                          <Badge variant="secondary" className="h-5">
                            Off
                          </Badge>
                        )}
                      </div>
                      {p.body && (
                        <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">
                          {p.body}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                        <Calendar className="h-3 w-3" />
                        {scheduleSummary(p)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditing(fromPromo(p))}
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDelete(p)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </CardContent>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit promo" : "New promo"}</DialogTitle>
            <DialogDescription>
              Shown on the customer display between orders. Schedule fields are optional.
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  placeholder="Friday family deal"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Body</Label>
                <Textarea
                  rows={3}
                  value={editing.body}
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  placeholder="Buy 2 mandi, get 1 free juice."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Image URL</Label>
                  <Input
                    value={editing.image_url}
                    onChange={(e) => setEditing({ ...editing, image_url: e.target.value })}
                    placeholder="https://…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Accent color</Label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      className="h-10 w-12 rounded border bg-background cursor-pointer"
                      value={editing.accent_color || "#00A859"}
                      onChange={(e) =>
                        setEditing({ ...editing, accent_color: e.target.value })
                      }
                    />
                    <Input
                      value={editing.accent_color}
                      onChange={(e) =>
                        setEditing({ ...editing, accent_color: e.target.value })
                      }
                      placeholder="#00A859"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Starts on</Label>
                  <Input
                    type="date"
                    value={editing.starts_on}
                    onChange={(e) => setEditing({ ...editing, starts_on: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Ends on</Label>
                  <Input
                    type="date"
                    value={editing.ends_on}
                    onChange={(e) => setEditing({ ...editing, ends_on: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" /> Days of week
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((d, i) => {
                    const on = editing.days_of_week.includes(i);
                    return (
                      <Button
                        key={d}
                        type="button"
                        size="sm"
                        variant={on ? "default" : "outline"}
                        onClick={() => toggleDay(i)}
                      >
                        {d}
                      </Button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave empty to show every day.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> Start time
                  </Label>
                  <Input
                    type="time"
                    value={editing.start_time}
                    onChange={(e) => setEditing({ ...editing, start_time: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>End time</Label>
                  <Input
                    type="time"
                    value={editing.end_time}
                    onChange={(e) => setEditing({ ...editing, end_time: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Order</Label>
                  <Input
                    type="number"
                    value={editing.sort_order}
                    onChange={(e) =>
                      setEditing({ ...editing, sort_order: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="flex items-end justify-between pb-1">
                  <Label>Active</Label>
                  <Switch
                    checked={editing.is_active}
                    onCheckedChange={(v) => setEditing({ ...editing, is_active: v })}
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={onSavePromo} disabled={saving}>
              {saving ? "Saving…" : "Save promo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
