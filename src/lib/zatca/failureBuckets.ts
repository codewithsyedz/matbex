export type FailureBucket = "schema" | "signature" | "network" | "fatoora" | "unknown";

export const FAILURE_BUCKET_LABEL: Record<FailureBucket, string> = {
  schema: "Schema",
  signature: "Signature",
  network: "Network",
  fatoora: "Fatoora",
  unknown: "Other",
};

export function categorizeFailure(status: string | null, response: unknown): FailureBucket {
  if (status === "SCHEMA_INVALID") return "schema";
  const r = (response ?? {}) as Record<string, unknown>;
  const cat = (r.errorCategory as string | undefined)?.toLowerCase();
  if (cat && cat in FAILURE_BUCKET_LABEL) return cat as FailureBucket;
  const text = JSON.stringify(r).toLowerCase();
  if (text.includes("signature") || text.includes("certificate")) return "signature";
  if (text.includes("timeout") || text.includes("network") || text.includes("econn")) return "network";
  if (text.includes("fatoora") || text.includes("clearance") || text.includes("invoice")) return "fatoora";
  return "unknown";
}