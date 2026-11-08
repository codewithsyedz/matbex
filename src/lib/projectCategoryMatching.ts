/**
 * Automatic matching of project transactions to imported budget categories.
 *
 * Two signal sources, in priority order:
 *  1. Vendor learning — a vendor already categorised on this project wins outright.
 *  2. Keyword overlap — tokens of the category name (plus manual synonyms) found in
 *     the transaction vendor name / description / notes.
 */

export interface MatchableTransaction {
  id: string;
  vendor_name: string | null;
  description: string | null;
  notes?: string | null;
  category: string | null;
}

export interface CategorySuggestion {
  transactionId: string;
  category: string;
  confidence: number; // 0..1
  reason: string;
}

const STOP_WORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "cost",
  "costs",
  "other",
  "others",
  "misc",
  "general",
  "expense",
  "expenses",
  "charges",
  "work",
  "works",
  "item",
  "items",
  "project",
]);

/** Extra hints so common trade words map to typical construction budget heads. */
const SYNONYMS: Record<string, string[]> = {
  electrical: ["wire", "cable", "switch", "led", "light", "breaker", "db", "socket"],
  plumbing: ["pipe", "upvc", "ppr", "sanitary", "tap", "drain", "sink", "water"],
  civil: ["cement", "sand", "block", "brick", "concrete", "steel", "mason"],
  paint: ["painter", "primer", "putty", "emulsion", "coating"],
  tiles: ["tile", "marble", "granite", "grout", "ceramic"],
  kitchen: ["hood", "burner", "fryer", "chiller", "freezer", "griddle", "steel table"],
  furniture: ["chair", "table", "sofa", "counter", "carpenter", "wood", "mdf"],
  signage: ["sign", "board", "acrylic", "branding", "flex", "vinyl"],
  ac: ["hvac", "air condition", "split unit", "duct", "compressor"],
  labour: ["labor", "wage", "helper", "worker", "manpower", "contractor"],
  permits: ["permit", "license", "municipality", "balady", "fee", "government"],
  rent: ["rental", "lease", "advance rent"],
};

const normalise = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function categoryKeywords(category: string): string[] {
  const norm = normalise(category);
  const tokens = norm.split(" ").filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  const extra = Object.entries(SYNONYMS)
    .filter(([key]) => norm.includes(key))
    .flatMap(([, words]) => words);
  return Array.from(new Set([...tokens, ...extra]));
}

/** Vendor -> category map learned from transactions that already carry a category. */
export function learnVendorCategories(transactions: MatchableTransaction[]) {
  const counts = new Map<string, Map<string, number>>();
  for (const t of transactions) {
    const vendor = normalise(t.vendor_name ?? "");
    const category = (t.category ?? "").trim();
    if (!vendor || !category) continue;
    const inner = counts.get(vendor) ?? new Map<string, number>();
    inner.set(category, (inner.get(category) ?? 0) + 1);
    counts.set(vendor, inner);
  }
  const map = new Map<string, { category: string; hits: number }>();
  for (const [vendor, inner] of counts) {
    const [category, hits] = [...inner.entries()].sort((a, b) => b[1] - a[1])[0];
    map.set(vendor, { category, hits });
  }
  return map;
}

export function suggestCategories(input: {
  transactions: MatchableTransaction[];
  categories: string[];
  /** Only propose for transactions that have no category yet (default true). */
  uncategorisedOnly?: boolean;
  minConfidence?: number;
}): CategorySuggestion[] {
  const { transactions, categories } = input;
  const uncategorisedOnly = input.uncategorisedOnly ?? true;
  const minConfidence = input.minConfidence ?? 0.3;

  const vendorMap = learnVendorCategories(transactions);
  const keywordIndex = categories.map((category) => ({
    category,
    keywords: categoryKeywords(category),
    normalised: normalise(category),
  }));

  const out: CategorySuggestion[] = [];
  for (const t of transactions) {
    if (uncategorisedOnly && (t.category ?? "").trim()) continue;
    const vendor = normalise(t.vendor_name ?? "");
    const haystack = normalise(
      [t.vendor_name, t.description, t.notes].filter(Boolean).join(" "),
    );
    if (!haystack) continue;

    const learned = vendor ? vendorMap.get(vendor) : undefined;
    if (learned && categories.includes(learned.category)) {
      out.push({
        transactionId: t.id,
        category: learned.category,
        confidence: Math.min(0.95, 0.7 + learned.hits * 0.05),
        reason: `Vendor “${t.vendor_name}” was previously booked to ${learned.category}`,
      });
      continue;
    }

    let best: { category: string; score: number; matched: string[] } | null = null;
    for (const entry of keywordIndex) {
      let score = 0;
      const matched: string[] = [];
      if (entry.normalised && haystack.includes(entry.normalised)) {
        score += 2;
        matched.push(entry.category);
      }
      for (const kw of entry.keywords) {
        if (haystack.includes(kw)) {
          score += 1;
          matched.push(kw);
        }
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { category: entry.category, score, matched };
      }
    }
    if (!best) continue;
    const confidence = Math.min(0.9, 0.3 + best.score * 0.2);
    if (confidence < minConfidence) continue;
    out.push({
      transactionId: t.id,
      category: best.category,
      confidence,
      reason: `Matched keyword${best.matched.length > 1 ? "s" : ""}: ${Array.from(
        new Set(best.matched),
      )
        .slice(0, 3)
        .join(", ")}`,
    });
  }
  return out;
}