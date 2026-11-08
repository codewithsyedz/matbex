import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import i18n from "i18next";
import { supabase } from "@/integrations/supabase/client";

export interface LandingString {
  id: string;
  key: string;
  group_name: string;
  value_en: string | null;
  value_ar: string | null;
  updated_at: string;
}

/** Convert a flat list of dotted keys into a nested object for i18next. */
function toNested(rows: Array<{ key: string; value: string | null }>) {
  const out: Record<string, unknown> = {};
  for (const { key, value } of rows) {
    if (value == null || value === "") continue;
    const parts = key.split(".");
    let node: any = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (typeof node[k] !== "object" || node[k] === null) node[k] = {};
      node = node[k];
    }
    node[parts[parts.length - 1]] = value;
  }
  return out;
}

/**
 * Fetch all landing-page strings from the CMS and merge them into i18next
 * for both EN and AR, overriding any defaults shipped in the JSON bundles.
 * Components keep using `t("landing.x.y")` — values come from the database.
 */
export function useLandingStrings() {
  const query = useQuery({
    queryKey: ["landing-strings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("landing_strings")
        .select("id,key,group_name,value_en,value_ar,updated_at")
        .order("key");
      if (error) throw error;
      return (data ?? []) as LandingString[];
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const rows = query.data;
    if (!rows || rows.length === 0) return;
    const en = toNested(rows.map((r) => ({ key: r.key, value: r.value_en })));
    const ar = toNested(rows.map((r) => ({ key: r.key, value: r.value_ar })));
    // deep=true, overwrite=true — replaces the JSON-shipped defaults at runtime.
    i18n.addResourceBundle("en", "translation", en, true, true);
    i18n.addResourceBundle("ar", "translation", ar, true, true);
    // Nudge consumers so already-mounted components re-render with new values.
    i18n.emit("languageChanged", i18n.language);
  }, [query.data]);

  return query;
}