import { Plus, UtensilsCrossed, Pizza, Coffee, IceCream, Beef, Soup, Salad, Sandwich, Cookie, GlassWater, CakeSlice, Drumstick, ChefHat } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export type PosLayoutTemplate = "classic_dense" | "showcase" | "compact_list" | "kiosk_grid" | "poscom_card";

export interface PosLayoutConfig {
  /** Show the top category strip / chips. Default true. */
  showCategoryStrip?: boolean;
  /** Show the "Choose Items" heading. Default true. */
  showChooseItemsTitle?: boolean;
  /** Show per-category section headers in the grid. Default true. */
  showCategoryHeaders?: boolean;
  /** Show item description text. Default true. */
  showDescription?: boolean;
  /** Image shape: fully round, rounded corners, or square. */
  imageShape?: "round" | "rounded" | "square";
  /** Tighten top padding/margins so the item area sits higher. */
  compactTopSpacing?: boolean;
  /** Float the item image above the card top (overhanging thumbnail). */
  floatImageTop?: boolean;
  /** Show the combined "Invoice, Payment & Settlement" cart section. Default true. */
  showInvoicePaymentSection?: boolean;
}

const DEFAULT_CONFIG: Required<PosLayoutConfig> = {
  showCategoryStrip: true,
  showChooseItemsTitle: true,
  showCategoryHeaders: true,
  showDescription: true,
  imageShape: "rounded",
  compactTopSpacing: false,
  floatImageTop: false,
  showInvoicePaymentSection: true,
};

export function resolveLayoutConfig(c?: PosLayoutConfig | null): Required<PosLayoutConfig> {
  return { ...DEFAULT_CONFIG, ...(c ?? {}) };
}

function imageRadiusClass(shape: PosLayoutConfig["imageShape"]) {
  if (shape === "round") return "rounded-full";
  if (shape === "square") return "rounded-none";
  return "rounded-2xl";
}

export interface PosMenuItem {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  image_url?: string | null;
  selling_price: number;
  quarter_price: number;
  half_price: number;
  full_price: number;
}

export interface POSLayoutProps {
  categories: string[];
  selectedCategory: string;
  setSelectedCategory: (c: string) => void;
  groupedItems: Record<string, PosMenuItem[]>;
  addToCart: (item: PosMenuItem, size: "quarter" | "half" | "full" | "regular") => void;
  hasVariantPrices: (item: PosMenuItem) => boolean;
  formatCurrency: (n: number) => string;
  footer?: ReactNode;
  config?: PosLayoutConfig;
  /** Max columns at the largest breakpoint. Defaults vary per template. */
  gridColumns?: 2 | 3 | 4 | 5 | 6;
}

/** Build a responsive grid class that scales up to `cols`. */
export function gridColsClass(cols: number | undefined, fallback: 2 | 3 | 4 | 5 | 6) {
  const n = (cols && cols >= 2 && cols <= 6 ? cols : fallback) as 2 | 3 | 4 | 5 | 6;
  switch (n) {
    case 2: return "grid grid-cols-2 gap-3";
    case 3: return "grid grid-cols-2 sm:grid-cols-3 gap-3";
    case 4: return "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3";
    case 5: return "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3";
    case 6: return "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3";
  }
}

/* ─────────────────────────  helpers  ───────────────────────── */

export function categoryIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes("pizza")) return Pizza;
  if (n.includes("burger") || n.includes("sandwich")) return Sandwich;
  if (n.includes("beef") || n.includes("steak") || n.includes("meat")) return Beef;
  if (n.includes("chicken") || n.includes("wings")) return Drumstick;
  if (n.includes("ice") || n.includes("dessert")) return IceCream;
  if (n.includes("cake") || n.includes("sweet") || n.includes("pastry")) return CakeSlice;
  if (n.includes("cookie") || n.includes("biscuit")) return Cookie;
  if (n.includes("juice") || n.includes("water") || n.includes("drink") || n.includes("beverage") || n.includes("soda")) return GlassWater;
  if (n.includes("coffee") || n.includes("tea") || n.includes("hot")) return Coffee;
  if (n.includes("soup")) return Soup;
  if (n.includes("salad")) return Salad;
  if (n.includes("main") || n.includes("kitchen") || n.includes("chef")) return ChefHat;
  return UtensilsCrossed;
}

function VariantOrAdd({
  item,
  addToCart,
  formatCurrency,
  size = "md",
}: {
  item: PosMenuItem;
  addToCart: POSLayoutProps["addToCart"];
  formatCurrency: (n: number) => string;
  size?: "sm" | "md" | "lg";
}) {
  const { t } = useTranslation();
  const variants: { size: "quarter" | "half" | "full"; price: number; label: string }[] = [];
  if (item.quarter_price > 0) variants.push({ size: "quarter", price: item.quarter_price, label: t("app.pos.recorder.quarter") });
  if (item.half_price > 0) variants.push({ size: "half", price: item.half_price, label: t("app.pos.recorder.half") });
  if (item.full_price > 0) variants.push({ size: "full", price: item.full_price, label: t("app.pos.recorder.full") });

  const pad = size === "lg" ? "py-2 px-3 text-sm" : size === "sm" ? "py-1 px-1.5 text-[10px]" : "py-1.5 px-2 text-xs";

  if (variants.length === 1) {
    return (
      <button
        onClick={() => addToCart(item, variants[0].size)}
        className={`w-full flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all ${pad}`}
      >
        <Plus className="h-4 w-4" />
        <span className="font-medium">{formatCurrency(variants[0].price)}</span>
      </button>
    );
  }

  if (variants.length > 1) {
    const btn = "py-1.5 px-1 rounded-md border bg-background hover:border-primary hover:bg-primary/5 active:scale-95 transition-all text-center min-w-0";
    const colsClass = variants.length === 2 ? "grid-cols-2" : "grid-cols-3";
    return (
      <div className={`grid ${colsClass} gap-1`}>
        {variants.map((v) => (
          <button
            key={v.size}
            onClick={() => addToCart(item, v.size)}
            className={`${btn} ${v.size === "full" ? "border-primary/30 bg-primary/5" : "border-border"}`}
          >
            <p className={`text-[8px] font-medium uppercase truncate ${v.size === "full" ? "text-primary" : "text-muted-foreground"}`}>
              {v.label}
            </p>
            <p className={`text-[10px] font-semibold truncate ${v.size === "full" ? "text-primary" : ""}`}>
              {formatCurrency(v.price)}
            </p>
          </button>
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => addToCart(item, "regular")}
      className={`w-full flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all ${pad}`}
    >
      <Plus className="h-4 w-4" />
      <span className="font-medium">{formatCurrency(item.selling_price)}</span>
    </button>
  );
}

/* ─────────────────────  Showcase (attachment)  ───────────────────── */

export function ShowcaseLayout(props: POSLayoutProps) {
  const { t } = useTranslation();
  const { categories, selectedCategory, setSelectedCategory, groupedItems, addToCart, hasVariantPrices, formatCurrency, footer, config, gridColumns } = props;
  const cfg = resolveLayoutConfig(config);
  const imgShape = imageRadiusClass(cfg.imageShape === "rounded" ? "round" : cfg.imageShape); // floating thumb defaults to round
  return (
    <>
      {cfg.showCategoryStrip && (
      <div className={`flex-shrink-0 ${cfg.compactTopSpacing ? "mb-1" : "mb-3"} -mx-3 px-3 overflow-x-auto`}>
        <div className="flex gap-3 pb-2">
          <CategoryIconTile label={t("app.pos.order.all")} active={selectedCategory === "all"} Icon={UtensilsCrossed} onClick={() => setSelectedCategory("all")} />
          {categories.map((cat) => {
            const Icon = categoryIcon(cat);
            return (
              <CategoryIconTile key={cat} label={cat} Icon={Icon} active={selectedCategory === cat} onClick={() => setSelectedCategory(cat)} />
            );
          })}
        </div>
      </div>
      )}

      <ScrollArea className="flex-1 min-h-0">
        {cfg.showChooseItemsTitle && <h2 className={`text-lg font-semibold ${cfg.compactTopSpacing ? "mb-1" : "mb-3"}`}>{t("app.pos.order.selectItems")}</h2>}
        <div className={`${cfg.compactTopSpacing ? "space-y-3 pt-0" : "space-y-6"} pb-4`}>
          {Object.entries(groupedItems).map(([category, items]) => (
            <div key={category}>
              {cfg.showCategoryHeaders && Object.keys(groupedItems).length > 1 && (
                <h3 className="text-xs font-semibold text-primary uppercase tracking-widest mb-3 flex items-center gap-2">
                  <span className="h-px flex-1 bg-border" />
                  {category}
                  <span className="h-px flex-1 bg-border" />
                </h3>
              )}
              <div className={gridColsClass(gridColumns, 3)}>
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="group relative bg-card rounded-2xl border border-border p-3 pt-10 hover:border-primary/40 hover:shadow-lg transition-all"
                  >
                    {/* floating image */}
                    <div className={`absolute -top-7 left-1/2 -translate-x-1/2 w-20 h-20 ${imgShape} bg-muted overflow-hidden flex items-center justify-center shadow-md`}>
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                      ) : (
                        <UtensilsCrossed className="h-7 w-7 text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="text-center mt-1">
                      <p className="font-bold text-xs mb-0.5 line-clamp-1" title={item.name}>{item.name}</p>
                      {cfg.showDescription && (
                        <p className="text-[10px] text-muted-foreground line-clamp-2 min-h-[1.75rem] mb-2">
                          {item.description || "—"}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      {hasVariantPrices(item) ? (
                        <div className="flex-1">
                          <VariantOrAdd item={item} addToCart={addToCart} formatCurrency={formatCurrency} />
                        </div>
                      ) : (
                        <>
                          <p className="text-lg font-bold text-primary">{formatCurrency(item.selling_price)}</p>
                          <button
                            onClick={() => addToCart(item, "regular")}
                            className="h-9 w-9 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all flex items-center justify-center"
                          >
                            <Plus className="h-5 w-5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {footer}
        </div>
      </ScrollArea>
    </>
  );
}

export function CategoryIconTile({
  label,
  Icon,
  active,
  onClick,
  variant = "showcase",
}: {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
  variant?: PosLayoutTemplate;
}) {
  // Per-template visual style for category tiles
  switch (variant) {
    case "classic_dense":
      // Compact pill-style chip with small icon
      return (
        <button
          onClick={onClick}
          className={`flex-shrink-0 h-10 px-3 flex items-center gap-1.5 rounded-lg border transition-all active:scale-95 ${
            active
              ? "border-primary bg-primary text-primary-foreground shadow-sm"
              : "border-border bg-background text-foreground hover:bg-muted"
          }`}
        >
          <Icon className="h-4 w-4" />
          <span className="text-xs font-semibold capitalize whitespace-nowrap">{label}</span>
        </button>
      );
    case "compact_list":
      // Minimal text-first row with tiny icon
      return (
        <button
          onClick={onClick}
          className={`flex-shrink-0 h-9 px-3 flex items-center gap-1.5 rounded-md transition-all active:scale-95 ${
            active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="text-xs font-medium capitalize whitespace-nowrap">{label}</span>
        </button>
      );
    case "kiosk_grid":
      // Extra-large touch-friendly tile
      return (
        <button
          onClick={onClick}
          className={`flex-shrink-0 w-28 flex flex-col items-center gap-2 px-3 py-3 rounded-2xl border-2 transition-all active:scale-95 ${
            active ? "border-primary bg-primary/10 text-primary shadow-md" : "border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          <Icon className="h-10 w-10" />
          <span className="text-sm font-bold capitalize truncate w-full text-center">{label}</span>
        </button>
      );
    case "poscom_card":
      // Card-style with filled background bubble
      return (
        <button
          onClick={onClick}
          className={`flex-shrink-0 w-20 flex flex-col items-center gap-1.5 transition-all active:scale-95`}
        >
          <div
            className={`h-14 w-14 rounded-2xl flex items-center justify-center transition-all ${
              active ? "bg-primary text-primary-foreground shadow-md" : "bg-muted text-muted-foreground"
            }`}
          >
            <Icon className="h-6 w-6" />
          </div>
          <span className={`text-[11px] font-semibold capitalize truncate w-full text-center ${active ? "text-primary" : "text-muted-foreground"}`}>
            {label}
          </span>
        </button>
      );
    case "showcase":
    default:
      // Outlined square with icon above label
      return (
        <button
          onClick={onClick}
          className={`flex-shrink-0 w-20 flex flex-col items-center gap-1.5 px-2 py-2 rounded-xl border-2 transition-all active:scale-95 ${
            active ? "border-primary bg-primary/5 text-primary shadow-sm" : "border-transparent text-muted-foreground hover:bg-muted"
          }`}
        >
          <Icon className="h-7 w-7" />
          <span className="text-[11px] font-semibold capitalize truncate w-full text-center">{label}</span>
        </button>
      );
  }
}

/* ─────────────────────────  Compact List  ───────────────────────── */

export function CompactListLayout(props: POSLayoutProps) {
  const { t } = useTranslation();
  const { categories, selectedCategory, setSelectedCategory, groupedItems, addToCart, hasVariantPrices, formatCurrency, footer, config } = props;
  const cfg = resolveLayoutConfig(config);
  return (
    <>
      {cfg.showCategoryStrip && (
      <div className={`flex-shrink-0 ${cfg.compactTopSpacing ? "mb-0" : "mb-2"} -mx-3 px-3 overflow-x-auto`}>
        <div className="flex gap-2 pb-1">
          <Chip active={selectedCategory === "all"} onClick={() => setSelectedCategory("all")}>{t("app.pos.order.all")}</Chip>
          {categories.map((c) => (
            <Chip key={c} active={selectedCategory === c} onClick={() => setSelectedCategory(c)}>{c}</Chip>
          ))}
        </div>
      </div>
      )}
      <ScrollArea className="flex-1 min-h-0">
        <div className={`${cfg.compactTopSpacing ? "space-y-2" : "space-y-4"} pb-4`}>
          {Object.entries(groupedItems).map(([category, items]) => (
            <div key={category}>
              {cfg.showCategoryHeaders && (
                <h3 className="text-[10px] font-semibold text-primary uppercase tracking-widest mb-1">{category}</h3>
              )}
              <div className="divide-y divide-border border border-border rounded-lg overflow-hidden bg-card">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{item.name}</p>
                      {cfg.showDescription && item.description && <p className="text-xs text-muted-foreground truncate">{item.description}</p>}
                    </div>
                    <div className="w-44 flex-shrink-0">
                      <VariantOrAdd item={item} addToCart={addToCart} formatCurrency={formatCurrency} size="sm" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {footer}
        </div>
      </ScrollArea>
    </>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition-all active:scale-95 ${
        active ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground hover:bg-muted/80"
      }`}
    >
      {children}
    </button>
  );
}

/* ─────────────────────────  Kiosk Grid  ───────────────────────── */

export function KioskGridLayout(props: POSLayoutProps) {
  const { t } = useTranslation();
  const { categories, selectedCategory, setSelectedCategory, groupedItems, addToCart, hasVariantPrices, formatCurrency, footer, config, gridColumns } = props;
  const cfg = resolveLayoutConfig(config);
  const imgShape = imageRadiusClass(cfg.imageShape);
  return (
    <>
      {cfg.showCategoryStrip && (
      <div className={`flex-shrink-0 ${cfg.compactTopSpacing ? "mb-1" : "mb-3"} -mx-3 px-3 overflow-x-auto`}>
        <div className="flex gap-3 pb-2">
          <CategoryIconTile label={t("app.pos.order.all")} active={selectedCategory === "all"} Icon={UtensilsCrossed} onClick={() => setSelectedCategory("all")} />
          {categories.map((c) => (
            <CategoryIconTile key={c} label={c} Icon={categoryIcon(c)} active={selectedCategory === c} onClick={() => setSelectedCategory(c)} />
          ))}
        </div>
      </div>
      )}
      <ScrollArea className="flex-1 min-h-0">
        <div className={`${cfg.compactTopSpacing ? "space-y-3" : "space-y-6"} pb-4`}>
          {Object.entries(groupedItems).map(([category, items]) => (
            <div key={category}>
              {cfg.showCategoryHeaders && Object.keys(groupedItems).length > 1 && (
                <h3 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">{category}</h3>
              )}
              <div className={gridColsClass(gridColumns, 2)}>
                {items.map((item) => (
                  <div key={item.id} className={`bg-card ${cfg.imageShape === "square" ? "rounded-lg" : "rounded-2xl"} overflow-hidden border-2 border-border hover:border-primary/50 transition-all`}>
                    <div className={`relative w-full pt-[45%] bg-muted ${imgShape === "rounded-full" ? "" : ""}`}>
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.name} className="absolute inset-0 w-full h-full object-cover" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <UtensilsCrossed className="h-12 w-12 text-muted-foreground/30" />
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="font-bold text-sm mb-0.5 line-clamp-1">{item.name}</p>
                      {cfg.showDescription && item.description && <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{item.description}</p>}
                      <VariantOrAdd item={item} addToCart={addToCart} formatCurrency={formatCurrency} size="lg" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {footer}
        </div>
      </ScrollArea>
    </>
  );
}

/* ─────────────────────────  POS.COM Card  ─────────────────────────
   Matches the attached "POS.COM" reference: image inside card top,
   bold name, gray description, large price + circular + button. */

export function PosComCardLayout(props: POSLayoutProps) {
  const { t } = useTranslation();
  const { categories, selectedCategory, setSelectedCategory, groupedItems, addToCart, hasVariantPrices, formatCurrency, footer, config, gridColumns } = props;
  const cfg = resolveLayoutConfig(config);
  // imgShape applied inline via cfg.imageShape below
  return (
    <>
      {cfg.showCategoryStrip && (
      <div className={`flex-shrink-0 ${cfg.compactTopSpacing ? "mb-1" : "mb-3"} -mx-3 px-3 overflow-x-auto`}>
        <div className="flex gap-3 pb-2 items-end">
          <CategoryIconTile label={t("app.pos.order.all")} active={selectedCategory === "all"} Icon={UtensilsCrossed} onClick={() => setSelectedCategory("all")} />
          {categories.map((c) => (
            <CategoryIconTile key={c} label={c} Icon={categoryIcon(c)} active={selectedCategory === c} onClick={() => setSelectedCategory(c)} />
          ))}
        </div>
      </div>
      )}
      <ScrollArea className="flex-1 min-h-0">
        {cfg.showChooseItemsTitle && <h2 className={`text-xl font-bold ${cfg.compactTopSpacing ? "mb-2" : "mb-4"}`}>{t("app.pos.order.selectItems")}</h2>}
        <div className={`${cfg.compactTopSpacing ? "space-y-3" : "space-y-6"} pb-4`}>
          {Object.entries(groupedItems).map(([category, items]) => (
            <div key={category}>
              {cfg.showCategoryHeaders && Object.keys(groupedItems).length > 1 && (
                <h3 className="text-xs font-semibold text-primary uppercase tracking-widest mb-3">{category}</h3>
              )}
              <div className={gridColsClass(gridColumns, 3)}>
                {items.map((item) => (
                  <div
                    key={item.id}
                    className={`relative bg-card ${cfg.imageShape === "square" ? "rounded-md" : "rounded-xl"} border-2 border-primary/15 hover:border-primary/40 hover:shadow-md transition-all flex flex-col ${cfg.floatImageTop ? "mt-8 overflow-visible" : "overflow-hidden"}`}
                  >
                    {cfg.floatImageTop ? (
                      <div className={`absolute -top-8 left-1/2 -translate-x-1/2 w-20 h-20 ${imageRadiusClass(cfg.imageShape === "rounded" ? "round" : cfg.imageShape)} bg-muted overflow-hidden flex items-center justify-center shadow-md ring-4 ring-background`}>
                        {item.image_url ? (
                          <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                        ) : (
                          <UtensilsCrossed className="h-8 w-8 text-muted-foreground/40" />
                        )}
                      </div>
                    ) : (
                      <div className={`h-24 bg-muted/30 flex items-center justify-center p-2 ${cfg.imageShape === "round" ? "[&>img]:rounded-full [&>img]:h-full [&>img]:w-auto" : cfg.imageShape === "rounded" ? "[&>img]:rounded-xl" : ""}`}>
                        {item.image_url ? (
                          <img src={item.image_url} alt={item.name} className="max-h-full max-w-full object-contain" />
                        ) : (
                          <UtensilsCrossed className="h-10 w-10 text-muted-foreground/30" />
                        )}
                      </div>
                    )}
                    <div className={`p-2 flex-1 flex flex-col ${cfg.floatImageTop ? "pt-14 text-center" : ""}`}>
                      <p className="font-bold text-sm mb-0.5 line-clamp-1" title={item.name}>{item.name}</p>
                      {cfg.showDescription && (
                        <p className="text-[10px] text-muted-foreground line-clamp-2 mb-2 flex-1 min-h-[1.5rem]">
                           {item.description || "—"}
                        </p>
                      )}
                      {hasVariantPrices(item) ? (
                        <VariantOrAdd item={item} addToCart={addToCart} formatCurrency={formatCurrency} />
                      ) : (
                        <div className={`flex items-center gap-2 ${cfg.floatImageTop ? "justify-center" : "justify-between"}`}>
                          <p className="text-base font-bold text-primary">{formatCurrency(item.selling_price)}</p>
                          <button
                            onClick={() => addToCart(item, "regular")}
                             aria-label={`${t("app.pos.recorder.add")} ${item.name}`}
                            className="h-8 w-8 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all flex items-center justify-center shadow-sm"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {footer}
        </div>
      </ScrollArea>
    </>
  );
}