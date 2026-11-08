import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useComparisonContent,
  ComparisonColumn,
  ComparisonRow,
  ComparisonCellValue,
} from "@/hooks/useComparisonContent";

const CELL_OPTIONS: { value: string; label: string }[] = [
  { value: "true", label: "✓ Yes" },
  { value: "false", label: "— No" },
  { value: "addon", label: "Add-on" },
  { value: "text", label: "Custom text…" },
];

function cellToOption(v: ComparisonCellValue | undefined): string {
  if (v === true) return "true";
  if (v === false || v === undefined) return "false";
  if (v === "addon") return "addon";
  return "text";
}

function optionToCell(opt: string, text: string): ComparisonCellValue {
  if (opt === "true") return true;
  if (opt === "false") return false;
  if (opt === "addon") return "addon";
  return text;
}

export const ComparisonEditor = () => {
  const {
    settings,
    columns,
    rows,
    isLoading,
    updateSettings,
    updateColumn,
    createColumn,
    deleteColumn,
    updateRow,
    createRow,
    deleteRow,
  } = useComparisonContent();

  if (isLoading) return <Skeleton className="h-[600px] w-full" />;

  return (
    <div className="space-y-6">
      <SettingsCard settings={settings} onSave={(d) => updateSettings.mutate(d)} isSaving={updateSettings.isPending} />
      <ColumnsCard
        columns={columns}
        onUpdate={(d) => updateColumn.mutate(d)}
        onCreate={(d) => createColumn.mutate(d)}
        onDelete={(id) => deleteColumn.mutate(id)}
      />
      <RowsCard
        rows={rows}
        columns={columns}
        onUpdate={(d) => updateRow.mutate(d)}
        onCreate={(d) => createRow.mutate(d)}
        onDelete={(id) => deleteRow.mutate(id)}
      />
    </div>
  );
};

// =========================================================================
// Settings
// =========================================================================
const SettingsCard = ({
  settings,
  onSave,
  isSaving,
}: {
  settings: any;
  onSave: (data: any) => void;
  isSaving: boolean;
}) => {
  const [form, setForm] = useState({
    eyebrow: settings?.eyebrow || "",
    headline_prefix: settings?.headline_prefix || "",
    headline_bold: settings?.headline_bold || "",
    subtitle: settings?.subtitle || "",
    footnote: settings?.footnote || "",
    eyebrow_ar: settings?.eyebrow_ar || "",
    headline_prefix_ar: settings?.headline_prefix_ar || "",
    headline_bold_ar: settings?.headline_bold_ar || "",
    subtitle_ar: settings?.subtitle_ar || "",
    footnote_ar: settings?.footnote_ar || "",
    is_active: settings?.is_active ?? true,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base font-medium">Comparison Section Header</CardTitle>
          <CardDescription>Eyebrow, headline, subtitle and footnote shown above the table</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="cmp-active" className="text-sm">Visible on site</Label>
          <Switch
            id="cmp-active"
            checked={form.is_active}
            onCheckedChange={(v) => setForm({ ...form, is_active: v })}
          />
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="en">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="en">English</TabsTrigger>
            <TabsTrigger value="ar">العربية</TabsTrigger>
          </TabsList>
          <TabsContent value="en" className="space-y-4 mt-4">
            <Field label="Eyebrow" value={form.eyebrow} onChange={(v) => setForm({ ...form, eyebrow: v })} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Headline (light)" value={form.headline_prefix} onChange={(v) => setForm({ ...form, headline_prefix: v })} />
              <Field label="Headline (emphasis)" value={form.headline_bold} onChange={(v) => setForm({ ...form, headline_bold: v })} />
            </div>
            <FieldTextarea label="Subtitle" value={form.subtitle} onChange={(v) => setForm({ ...form, subtitle: v })} rows={3} />
            <FieldTextarea label="Footnote" value={form.footnote} onChange={(v) => setForm({ ...form, footnote: v })} rows={2} />
          </TabsContent>
          <TabsContent value="ar" className="space-y-4 mt-4" dir="rtl">
            <Field label="Eyebrow (AR)" value={form.eyebrow_ar} onChange={(v) => setForm({ ...form, eyebrow_ar: v })} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Headline (light) AR" value={form.headline_prefix_ar} onChange={(v) => setForm({ ...form, headline_prefix_ar: v })} />
              <Field label="Headline (emphasis) AR" value={form.headline_bold_ar} onChange={(v) => setForm({ ...form, headline_bold_ar: v })} />
            </div>
            <FieldTextarea label="Subtitle (AR)" value={form.subtitle_ar} onChange={(v) => setForm({ ...form, subtitle_ar: v })} rows={3} />
            <FieldTextarea label="Footnote (AR)" value={form.footnote_ar} onChange={(v) => setForm({ ...form, footnote_ar: v })} rows={2} />
          </TabsContent>
        </Tabs>
        <Button className="mt-6" disabled={isSaving} onClick={() => onSave(form)}>
          {isSaving ? "Saving…" : "Save Header"}
        </Button>
      </CardContent>
    </Card>
  );
};

const Field = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <div className="space-y-1.5">
    <Label>{label}</Label>
    <Input value={value} onChange={(e) => onChange(e.target.value)} />
  </div>
);
const FieldTextarea = ({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) => (
  <div className="space-y-1.5">
    <Label>{label}</Label>
    <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} />
  </div>
);

// =========================================================================
// Columns (competitors)
// =========================================================================
const ColumnsCard = ({
  columns,
  onUpdate,
  onCreate,
  onDelete,
}: {
  columns: ComparisonColumn[];
  onUpdate: (d: any) => void;
  onCreate: (d: any) => void;
  onDelete: (id: string) => void;
}) => {
  const [editing, setEditing] = useState<ComparisonColumn | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base font-medium">Competitor Columns</CardTitle>
          <CardDescription>Add or edit the columns shown in the comparison table</CardDescription>
        </div>
        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="w-4 h-4 mr-2" />Add Column</Button>
          </DialogTrigger>
          <DialogContent>
            <ColumnForm
              onSubmit={(d) => { onCreate(d); setCreating(false); }}
              onCancel={() => setCreating(false)}
            />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-2">
        {columns.map((col) => (
          <div key={col.id} className="flex items-center justify-between p-3 border rounded-lg">
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="font-mono text-xs">{col.column_key}</Badge>
              <div>
                <p className="font-medium text-sm">{col.name}</p>
                {col.sublabel && <p className="text-xs text-muted-foreground">{col.sublabel}</p>}
              </div>
              {col.is_highlighted && <Badge className="bg-[#00A859]">Highlighted</Badge>}
              {!col.is_active && <Badge variant="secondary">Hidden</Badge>}
            </div>
            <div className="flex gap-1">
              <Dialog open={editing?.id === col.id} onOpenChange={(o) => !o && setEditing(null)}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => setEditing(col)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <ColumnForm
                    column={editing || undefined}
                    onSubmit={(d) => { onUpdate({ id: col.id, ...d }); setEditing(null); }}
                    onCancel={() => setEditing(null)}
                  />
                </DialogContent>
              </Dialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete column "{col.name}"?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Cell values for this column in existing rows will remain in the database but no longer display.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onDelete(col.id)}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

const ColumnForm = ({
  column,
  onSubmit,
  onCancel,
}: {
  column?: ComparisonColumn;
  onSubmit: (d: any) => void;
  onCancel: () => void;
}) => {
  const [form, setForm] = useState({
    column_key: column?.column_key || "",
    name: column?.name || "",
    name_ar: column?.name_ar || "",
    sublabel: column?.sublabel || "",
    sublabel_ar: column?.sublabel_ar || "",
    is_highlighted: column?.is_highlighted ?? false,
    sort_order: column?.sort_order ?? 99,
    is_active: column?.is_active ?? true,
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{column ? "Edit Column" : "Add Column"}</DialogTitle>
      </DialogHeader>
      <ScrollArea className="max-h-[60vh] pr-3">
        <div className="space-y-4 pt-2">
          <Field label="Key (unique, lowercase, e.g. 'foodics')" value={form.column_key} onChange={(v) => setForm({ ...form, column_key: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Name (AR)" value={form.name_ar} onChange={(v) => setForm({ ...form, name_ar: v })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sub-label" value={form.sublabel} onChange={(v) => setForm({ ...form, sublabel: v })} />
            <Field label="Sub-label (AR)" value={form.sublabel_ar} onChange={(v) => setForm({ ...form, sublabel_ar: v })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Sort order</Label>
              <Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value || "0") })} />
            </div>
            <div className="flex items-end gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={form.is_highlighted} onCheckedChange={(v) => setForm({ ...form, is_highlighted: v })} />
                <Label>Highlight</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                <Label>Active</Label>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSubmit(form)}>{column ? "Save" : "Create"}</Button>
      </DialogFooter>
    </>
  );
};

// =========================================================================
// Rows (capabilities)
// =========================================================================
const RowsCard = ({
  rows,
  columns,
  onUpdate,
  onCreate,
  onDelete,
}: {
  rows: ComparisonRow[];
  columns: ComparisonColumn[];
  onUpdate: (d: any) => void;
  onCreate: (d: any) => void;
  onDelete: (id: string) => void;
}) => {
  const [editing, setEditing] = useState<ComparisonRow | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base font-medium">Capability Rows</CardTitle>
          <CardDescription>Each row is one feature/capability with a value per competitor</CardDescription>
        </div>
        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="w-4 h-4 mr-2" />Add Row</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <RowForm
              columns={columns}
              onSubmit={(d) => { onCreate(d); setCreating(false); }}
              onCancel={() => setCreating(false)}
            />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center justify-between p-3 border rounded-lg">
            <div className="flex items-center gap-3 min-w-0">
              <Badge variant="outline" className="text-xs">#{row.sort_order}</Badge>
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{row.label}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {columns.map((c) => {
                    const v = row.cells?.[c.column_key];
                    const display = v === true ? "✓" : v === false || v === undefined ? "—" : v === "addon" ? "Add-on" : String(v);
                    return `${c.column_key}:${display}`;
                  }).join("  ·  ")}
                </p>
              </div>
              {row.is_footer && <Badge variant="secondary">Footer</Badge>}
              {!row.is_active && <Badge variant="secondary">Hidden</Badge>}
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <Dialog open={editing?.id === row.id} onOpenChange={(o) => !o && setEditing(null)}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => setEditing(row)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <RowForm
                    row={editing || undefined}
                    columns={columns}
                    onSubmit={(d) => { onUpdate({ id: row.id, ...d }); setEditing(null); }}
                    onCancel={() => setEditing(null)}
                  />
                </DialogContent>
              </Dialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete row "{row.label}"?</AlertDialogTitle>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onDelete(row.id)}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

const RowForm = ({
  row,
  columns,
  onSubmit,
  onCancel,
}: {
  row?: ComparisonRow;
  columns: ComparisonColumn[];
  onSubmit: (d: any) => void;
  onCancel: () => void;
}) => {
  // For each column, store {opt, text}
  const initialCells: Record<string, { opt: string; text: string }> = {};
  for (const c of columns) {
    const v = row?.cells?.[c.column_key];
    initialCells[c.column_key] = {
      opt: cellToOption(v),
      text: typeof v === "string" && v !== "addon" ? v : "",
    };
  }

  const [form, setForm] = useState({
    label: row?.label || "",
    label_ar: row?.label_ar || "",
    sort_order: row?.sort_order ?? 99,
    is_footer: row?.is_footer ?? false,
    is_active: row?.is_active ?? true,
    cells: initialCells,
  });

  const handleSubmit = () => {
    const cells: Record<string, ComparisonCellValue> = {};
    for (const c of columns) {
      const entry = form.cells[c.column_key];
      if (!entry) continue;
      cells[c.column_key] = optionToCell(entry.opt, entry.text);
    }
    onSubmit({
      label: form.label,
      label_ar: form.label_ar,
      sort_order: form.sort_order,
      is_footer: form.is_footer,
      is_active: form.is_active,
      cells,
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{row ? "Edit Row" : "Add Row"}</DialogTitle>
      </DialogHeader>
      <ScrollArea className="max-h-[70vh] pr-3">
        <div className="space-y-4 pt-2">
          <Field label="Capability label" value={form.label} onChange={(v) => setForm({ ...form, label: v })} />
          <Field label="Capability label (AR)" value={form.label_ar} onChange={(v) => setForm({ ...form, label_ar: v })} />
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Sort order</Label>
              <Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value || "0") })} />
            </div>
            <div className="flex items-end gap-2">
              <Switch checked={form.is_footer} onCheckedChange={(v) => setForm({ ...form, is_footer: v })} />
              <Label>Footer row (highlighted)</Label>
            </div>
            <div className="flex items-end gap-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              <Label>Active</Label>
            </div>
          </div>

          <div className="border rounded-lg p-3 space-y-3">
            <p className="text-sm font-medium">Values per column</p>
            {columns.map((c) => {
              const entry = form.cells[c.column_key] || { opt: "false", text: "" };
              return (
                <div key={c.column_key} className="grid grid-cols-[120px_140px_1fr] gap-2 items-center">
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{c.column_key}</p>
                  </div>
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={entry.opt}
                    onChange={(e) => setForm({ ...form, cells: { ...form.cells, [c.column_key]: { ...entry, opt: e.target.value } } })}
                  >
                    {CELL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {entry.opt === "text" ? (
                    <Input
                      placeholder="e.g. 199 ﷼"
                      value={entry.text}
                      onChange={(e) => setForm({ ...form, cells: { ...form.cells, [c.column_key]: { ...entry, text: e.target.value } } })}
                    />
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      {entry.opt === "true" ? <span className="inline-flex items-center gap-1 text-[#00713A]"><Check className="w-3 h-3" /> Shown as checkmark</span>
                        : entry.opt === "addon" ? "Shown as 'Add-on' badge"
                        : "Shown as dash (—)"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleSubmit}>{row ? "Save" : "Create"}</Button>
      </DialogFooter>
    </>
  );
};