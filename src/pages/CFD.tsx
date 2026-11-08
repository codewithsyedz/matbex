import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  useCFDDisplay,
  CFDCartItem,
  usePublicCFDIdle,
  filterActivePromos,
  type CFDIdleSettings,
  type CFDPromo,
} from "@/hooks/useCFD";
import { db } from "@/integrations/db/client";

// ---------------------------------------------------------------------
// Customer-Facing Display
// Route: /cfd
// Modes:
//   ?local=1                       → BroadcastChannel from same device
//   ?code=ABC123&restaurant=<uuid> → paired-tablet realtime
//   (no params)                    → ask for pair code
// ---------------------------------------------------------------------

interface PublicBranding {
  logo_url: string | null;
  business_display_name: string | null;
  tagline: string | null;
  primary_color: string;
}

function formatRiyal(n: number) {
  const v = Number.isFinite(n) ? n : 0;
  return `﷼${v.toFixed(2)}`;
}

function PairPrompt({ onPair }: { onPair: (rid: string, code: string) => void }) {
  const [code, setCode] = useState("");
  const [rid, setRid] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!code.trim()) return;
    setBusy(true);
    try {
      // Look up via SECURITY DEFINER RPC (anon SELECT on cfd_sessions is closed).
      const { data, error: e2 }: any = await (db as any).rpc("cfd_get_session", {
        p_restaurant_id: rid.trim() || null,
        p_pair_code: code.trim().toUpperCase(),
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (e2 || !row) {
        setError("Pair code not found. Ask the cashier to re-share it.");
        return;
      }
      onPair(row.restaurant_id, row.pair_code);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-light tracking-tight">Customer Display</h1>
          <p className="text-sm text-muted-foreground">
            Enter the pair code shown on the cashier's screen.
          </p>
        </div>
        <input
          autoFocus
          className="w-full h-16 text-center text-3xl tracking-[0.4em] uppercase font-mono border rounded-lg bg-card"
          value={code}
          maxLength={6}
          placeholder="------"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        <button
          type="submit"
          disabled={busy || code.length < 4}
          className="w-full h-12 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50"
        >
          {busy ? "Pairing…" : "Pair display"}
        </button>
      </form>
    </div>
  );
}

function IdleScreen({
  branding,
  settings,
  promos,
}: {
  branding: PublicBranding | null;
  settings: CFDIdleSettings | null;
  promos: CFDPromo[];
}) {
  const accent = branding?.primary_color || "#00A859";
  const heading = settings?.heading || branding?.business_display_name || "Welcome";
  const subheading = settings?.subheading || branding?.tagline || "أهلاً وسهلاً · Welcome";
  const showLogo = settings?.show_logo ?? true;
  const rotationMs = Math.max(3, settings?.rotation_seconds ?? 8) * 1000;

  // Re-evaluate active set every minute, rotate index every `rotation_seconds`.
  const [active, setActive] = useState<CFDPromo[]>(() => filterActivePromos(promos));
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setActive(filterActivePromos(promos));
    const tick = setInterval(() => setActive(filterActivePromos(promos)), 60_000);
    return () => clearInterval(tick);
  }, [promos]);

  useEffect(() => {
    if (active.length <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % active.length), rotationMs);
    return () => clearInterval(t);
  }, [active.length, rotationMs]);

  useEffect(() => {
    if (index >= active.length) setIndex(0);
  }, [active.length, index]);

  const current = active[index];

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center text-white"
      style={{
        background: `radial-gradient(circle at top, ${current?.accent_color || accent} 0%, #0a0a0a 70%)`,
        transition: "background 0.6s ease",
      }}
    >
      {showLogo && branding?.logo_url ? (
        <img
          src={branding.logo_url}
          alt={branding.business_display_name || "Logo"}
          className="h-32 w-32 object-contain rounded-2xl bg-white/10 backdrop-blur p-4 mb-8"
        />
      ) : showLogo ? (
        <div
          className="h-32 w-32 rounded-2xl mb-8 flex items-center justify-center text-5xl font-light"
          style={{ background: "rgba(255,255,255,0.1)" }}
        >
          {(branding?.business_display_name || "M").slice(0, 1)}
        </div>
      ) : null}
      <h1 className="text-6xl font-light tracking-tight mb-2 text-center px-6">{heading}</h1>
      <p className="text-xl text-white/70 text-center px-6">{subheading}</p>

      {/* Rotating promo card */}
      <div className="mt-12 w-full max-w-2xl px-6 min-h-[180px]">
        <AnimatePresence mode="wait">
          {current && (
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-2xl overflow-hidden backdrop-blur bg-white/10 border border-white/15"
            >
              {current.image_url && (
                <img
                  src={current.image_url}
                  alt={current.title}
                  className="w-full h-40 object-cover"
                />
              )}
              <div className="p-5">
                <div className="text-2xl font-medium">{current.title}</div>
                {current.body && (
                  <p className="text-base text-white/80 mt-1 leading-relaxed">{current.body}</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {active.length > 1 && (
        <div className="mt-6 flex gap-1.5">
          {active.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? "w-6 bg-white" : "w-1.5 bg-white/40"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CartScreen({
  cart,
  subtotal,
  tax,
  total,
}: {
  cart: CFDCartItem[];
  subtotal: number;
  tax: number;
  total: number;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground grid grid-rows-[auto_1fr_auto] p-8 gap-6">
      <header className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Your order</h1>
        <span className="text-sm text-muted-foreground">{cart.length} item{cart.length === 1 ? "" : "s"}</span>
      </header>

      <div className="overflow-auto space-y-2">
        <AnimatePresence initial={false}>
          {cart.map((item, idx) => (
            <motion.div
              key={`${item.name}-${item.size ?? ""}-${idx}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center justify-between py-4 px-5 rounded-xl bg-muted/40"
            >
              <div className="flex items-baseline gap-4">
                <span className="text-2xl font-medium w-12 text-primary">{item.quantity}×</span>
                <div>
                  <div className="text-xl font-medium">{item.name}</div>
                  {item.size && (
                    <div className="text-sm text-muted-foreground capitalize">{item.size}</div>
                  )}
                </div>
              </div>
              <div className="text-xl tabular-nums">{formatRiyal(item.total)}</div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <footer className="border-t pt-6 space-y-2">
        <div className="flex justify-between text-base text-muted-foreground">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatRiyal(subtotal)}</span>
        </div>
        {tax > 0 && (
          <div className="flex justify-between text-base text-muted-foreground">
            <span>VAT</span>
            <span className="tabular-nums">{formatRiyal(tax)}</span>
          </div>
        )}
        <div className="flex justify-between text-5xl font-light pt-2">
          <span>Total</span>
          <span className="tabular-nums">{formatRiyal(total)}</span>
        </div>
      </footer>
    </div>
  );
}

function MessageScreen({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-center p-8">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.25 }}
      >
        <h1 className="text-6xl font-light tracking-tight mb-4">{title}</h1>
        {sub && <p className="text-2xl text-muted-foreground">{sub}</p>}
      </motion.div>
    </div>
  );
}

export default function CFD() {
  const [params] = useSearchParams();
  const localOnly = params.get("local") === "1";
  const initialCode = params.get("code");
  const initialRid = params.get("restaurant");

  const [paired, setPaired] = useState<{ rid: string; code: string } | null>(
    initialCode && initialRid ? { rid: initialRid, code: initialCode.toUpperCase() } : null,
  );
  const [branding, setBranding] = useState<PublicBranding | null>(null);
  const { settings: idleSettings, promos } = usePublicCFDIdle(paired?.rid ?? null);

  // Hide preview chrome
  useEffect(() => {
    document.title = "Customer Display";
  }, []);

  // Load branding once we know the restaurant id (paired mode only)
  useEffect(() => {
    if (!paired?.rid) return;
    void (async () => {
      const { data } = await db
        .from("restaurant_branding")
        .select("logo_url, business_display_name, tagline, primary_color")
        .eq("restaurant_id", paired.rid)
        .maybeSingle();
      if (data) setBranding(data as PublicBranding);
    })();
  }, [paired?.rid]);

  const snap = useCFDDisplay({
    restaurantId: paired?.rid ?? null,
    pairCode: paired?.code ?? null,
    localOnly,
  });

  // Ask for code if no params and not local-only
  if (!localOnly && !paired) {
    return (
      <PairPrompt
        onPair={(rid, code) => {
          // Persist into the URL so a reload keeps the pairing.
          const url = new URL(window.location.href);
          url.searchParams.set("restaurant", rid);
          url.searchParams.set("code", code);
          window.history.replaceState(null, "", url.toString());
          setPaired({ rid, code });
        }}
      />
    );
  }

  const view = useMemo(() => {
    if (snap.state === "payment") {
      return (
        <MessageScreen
          title={snap.message || "Processing payment…"}
          sub={`Total ${formatRiyal(snap.total)}`}
        />
      );
    }
    if (snap.state === "thankyou") {
      return (
        <MessageScreen
          title={snap.message || "Thank you!"}
          sub={snap.orderRef ? `Order ${snap.orderRef}` : undefined}
        />
      );
    }
    if (snap.state === "cart" && snap.cart.length > 0) {
      return (
        <CartScreen
          cart={snap.cart}
          subtotal={snap.subtotal}
          tax={snap.tax}
          total={snap.total}
        />
      );
    }
    return <IdleScreen branding={branding} settings={idleSettings} promos={promos} />;
  }, [snap, branding, idleSettings, promos]);

  return <div className="min-h-screen bg-background">{view}</div>;
}