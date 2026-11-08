import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MAPPABLE_FIELDS, type ColumnMapping, type MappableField } from "@/lib/projectSheetImport";

const NONE = "__none__";

export function SheetColumnMapper({
  headers,
  mapping,
  onChange,
}: {
  headers: string[];
  mapping: ColumnMapping;
  onChange: (m: ColumnMapping) => void;
}) {
  const set = (field: MappableField, value: string) => {
    const next = { ...mapping };
    if (value === NONE) delete next[field];
    else next[field] = value;
    onChange(next);
  };

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm">Match spreadsheet columns to fields</Label>
        <span className="text-xs text-muted-foreground">{headers.length} columns detected</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {MAPPABLE_FIELDS.map(({ field, label, required }) => (
          <div key={field} className="flex items-center gap-2">
            <span className="w-32 shrink-0 text-xs text-muted-foreground">
              {label}
              {required && <span className="text-destructive"> *</span>}
            </span>
            <Select value={mapping[field] ?? NONE} onValueChange={(v) => set(field, v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Not mapped" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not mapped</SelectItem>
                {headers.map((h) => (
                  <SelectItem key={h} value={h}>
                    {h}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      {!mapping.amount && (
        <Badge variant="destructive" className="text-[11px]">
          Amount column is required
        </Badge>
      )}
    </div>
  );
}
