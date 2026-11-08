import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useKdsStations } from "@/hooks/useKDS";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ChefHat } from "lucide-react";
import { toast } from "sonner";

const TYPES = ["kitchen", "grill", "bar", "expo", "cold", "dessert"];

export default function KdsStations() {
  const { t } = useTranslation();
  const { stations, create, update, remove } = useKdsStations();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("kitchen");

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      await create.mutateAsync({ name: name.trim(), station_type: type });
      toast.success(t("app.kdsStations.stationCreated"));
      setName(""); setType("kitchen"); setOpen(false);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6 min-h-[56px]">
        <div className="flex items-center gap-2 min-w-[240px] flex-1">
          <ChefHat className="h-5 w-5 text-primary" />
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">{t("app.kdsStations.title")}</h1>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" /> {t("app.kdsStations.newStation")}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("app.kdsStations.createStation")}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder={t("app.kdsStations.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} />
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={handleCreate} className="w-full" disabled={create.isPending}>{t("app.kdsStations.create")}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {stations.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            {t("app.kdsStations.empty")}
          </Card>
        )}
        {stations.map((s) => (
          <Card key={s.id} className="p-4 flex items-center gap-3">
            <div className="flex-1">
              <div className="font-medium">{s.name}</div>
              <div className="text-xs text-muted-foreground capitalize">{s.station_type}</div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{t("app.kdsStations.active")}</span>
              <Switch
                checked={s.active}
                onCheckedChange={(v) => update.mutate({ id: s.id, active: v })}
              />
            </div>
            <Button variant="ghost" size="icon" onClick={() => {
              if (confirm(t("app.kdsStations.deleteConfirm", { name: s.name }))) remove.mutate(s.id);
            }}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
