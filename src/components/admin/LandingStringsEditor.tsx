import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Search, Save, Loader2, Languages } from "lucide-react";
import { toast } from "sonner";
import type { LandingString } from "@/hooks/useLandingStrings";

/** Decide if a string deserves a Textarea vs Input based on length / line breaks. */
const isLong = (s: string | null | undefined) =>
  !!s && (s.length > 80 || s.includes("\n"));

function StringRow({
  row,
  onSave,
  isSaving,
}: {
  row: LandingString;
  onSave: (id: string, en: string, ar: string) => void;
  isSaving: boolean;
}) {
  const [en, setEn] = useState(row.value_en ?? "");
  const [ar, setAr] = useState(row.value_ar ?? "");
  const dirty = en !== (row.value_en ?? "") || ar !== (row.value_ar ?? "");
  const long = isLong(en) || isLong(ar);

  return (
    <div className="border border-border rounded-lg p-4 space-y-3 bg-card">
      <div className="flex items-center justify-between gap-3">
        <code className="text-xs text-muted-foreground truncate" title={row.key}>
          {row.key}
        </code>
        {dirty && (
          <Button
            size="sm"
            onClick={() => onSave(row.id, en, ar)}
            disabled={isSaving}
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5 mr-1.5" />
            )}
            Save
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">English</Label>
          {long ? (
            <Textarea
              value={en}
              onChange={(e) => setEn(e.target.value)}
              rows={3}
              dir="ltr"
            />
          ) : (
            <Input value={en} onChange={(e) => setEn(e.target.value)} dir="ltr" />
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">العربية</Label>
          {long ? (
            <Textarea
              value={ar}
              onChange={(e) => setAr(e.target.value)}
              rows={3}
              dir="rtl"
              className="text-right"
            />
          ) : (
            <Input
              value={ar}
              onChange={(e) => setAr(e.target.value)}
              dir="rtl"
              className="text-right"
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function LandingStringsEditor() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-landing-strings"],
    queryFn: async () => {
      const { data, error } = await db
        .from("landing_strings")
        .select("id,key,group_name,value_en,value_ar,created_at,updated_at")
        .order("key");
      if (error) throw error;
      return (data ?? []) as LandingString[];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, en, ar }: { id: string; en: string; ar: string }) => {
      const { error } = await db
        .from("landing_strings")
        .update({ value_en: en, value_ar: ar })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-landing-strings"] });
      qc.invalidateQueries({ queryKey: ["landing-strings"] });
      toast.success("String updated");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save"),
  });

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? rows.filter(
          (r) =>
            r.key.toLowerCase().includes(q) ||
            (r.value_en ?? "").toLowerCase().includes(q) ||
            (r.value_ar ?? "").toLowerCase().includes(q)
        )
      : rows;
    const map = new Map<string, LandingString[]>();
    for (const r of filtered) {
      const g = r.group_name || "misc";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows, search]);

  const missingAr = rows.filter((r) => !r.value_ar).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Languages className="w-5 h-5" />
              Landing Page Strings (EN / AR)
            </CardTitle>
            <CardDescription>
              Edit every text on the landing page in English and Arabic. Changes
              go live immediately for all visitors.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{rows.length} keys</Badge>
            {missingAr > 0 && (
              <Badge variant="destructive">{missingAr} missing AR</Badge>
            )}
          </div>
        </div>
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by key or text in either language…"
            className="pl-9"
          />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            Loading strings…
          </div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No strings match your search.
          </div>
        ) : (
          <Accordion
            type="multiple"
            defaultValue={search ? groups.map(([g]) => g) : [groups[0]?.[0]].filter(Boolean) as string[]}
            className="space-y-2"
          >
            {groups.map(([group, items]) => (
              <AccordionItem
                key={group}
                value={group}
                className="border border-border rounded-lg px-4"
              >
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <span className="capitalize font-medium">{group}</span>
                    <Badge variant="outline" className="text-xs">
                      {items.length}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 pt-2">
                    {items.map((row) => (
                      <StringRow
                        key={row.id}
                        row={row}
                        isSaving={updateMutation.isPending}
                        onSave={(id, en, ar) =>
                          updateMutation.mutate({ id, en, ar })
                        }
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}