import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DocsVersion = {
  id: string;
  version: string;
  released_at: string;
  summary: string | null;
  app_version: string | null;
  schema_version: string | null;
  is_current: boolean;
  sort_order: number;
};

export type DocsStepVersion = {
  id: string;
  anchor: string;
  version_id: string;
  change_type: "added" | "updated" | "unchanged" | "deprecated";
  change_summary: string | null;
  version?: DocsVersion;
};

export function useDocsVersions() {
  return useQuery({
    queryKey: ["docs-versions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("docs_versions")
        .select("*")
        .order("sort_order", { ascending: false })
        .order("released_at", { ascending: false });
      if (error) throw error;
      return (data || []) as DocsVersion[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useDocsStepVersions() {
  return useQuery({
    queryKey: ["docs-step-versions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("docs_step_versions")
        .select("*, version:docs_versions(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as DocsStepVersion[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Returns the most recent change entry for a given docs anchor.
 * Useful for the per-step "Updated in vX.Y.Z" badge.
 */
export function useLatestStepVersion(anchor: string | undefined) {
  const { data: steps } = useDocsStepVersions();
  const { data: versions } = useDocsVersions();
  if (!anchor || !steps || !versions) return undefined;

  const orderIndex = new Map(versions.map((v, i) => [v.id, i])); // 0 = newest
  const matches = steps.filter((s) => s.anchor === anchor);
  if (matches.length === 0) return undefined;
  return matches.sort(
    (a, b) => (orderIndex.get(a.version_id) ?? 999) - (orderIndex.get(b.version_id) ?? 999),
  )[0];
}