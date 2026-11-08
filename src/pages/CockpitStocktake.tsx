import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { ArrowLeft, ClipboardCheck, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useCOGSSubmissions } from "@/hooks/useCOGSSubmissions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

const card = "rounded-2xl border bg-card/80 backdrop-blur-sm shadow-sm";

const numSchema = z
  .number({ invalid_type_error: "Must be a number" })
  .min(0, "Must be ≥ 0")
  .max(10_000_000, "Too large");

const formSchema = z.object({
  opening_stock_value: numSchema,
  purchases_value: numSchema,
  closing_stock_value: numSchema,
});

export default function CockpitStocktake() {
  const navigate = useNavigate();
  const { isOwner, isManager } = useAuth();
  const { format: fmt } = useCurrency();
  const { t } = useTranslation();
  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");

  const {
    submissions,
    isLoading,
    createSubmission,
    updateSubmission,
    submitForApproval,
    approveSubmission,
    getFoodCostStatus,
  } = useCOGSSubmissions({ from: today, to: today });

  const existing = useMemo(
    () =>
      submissions?.find(
        (s) => s.submission_date === todayStr && s.shift_type === "full",
      ) ?? null,
    [submissions, todayStr],
  );

  const [opening, setOpening] = useState("");
  const [purchases, setPurchases] = useState("");
  const [closing, setClosing] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing) {
      setOpening(String(existing.opening_stock_value ?? ""));
      setPurchases(String(existing.purchases_value ?? ""));
      setClosing(String(existing.closing_stock_value ?? ""));
    }
  }, [existing]);

  const parsed = formSchema.safeParse({
    opening_stock_value: Number(opening),
    purchases_value: Number(purchases),
    closing_stock_value: Number(closing),
  });

  const cogs = parsed.success
    ? Math.max(
        0,
        parsed.data.opening_stock_value +
          parsed.data.purchases_value -
          parsed.data.closing_stock_value,
      )
    : 0;

  const sales = Number(existing?.total_sales ?? 0);
  const fcPct = sales > 0 ? (cogs / sales) * 100 : 0;
  const fcStatus = getFoodCostStatus(fcPct);

  const isLocked = existing?.status === "approved";

  const handleSubmit = async () => {
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t("app.cockpitStocktake.checkNumbers"));
      return;
    }
    if (isLocked) return;

    setSaving(true);
    try {
      let id = existing?.id;
      if (!id) {
        const created = await createSubmission.mutateAsync({
          submission_date: todayStr,
          shift_type: "full",
        });
        id = created.id;
      }

      await updateSubmission.mutateAsync({
        id: id!,
        opening_stock_value: parsed.data.opening_stock_value,
        purchases_value: parsed.data.purchases_value,
        closing_stock_value: parsed.data.closing_stock_value,
      });

      if (!existing || existing.status === "draft" || existing.status === "rejected") {
        await submitForApproval.mutateAsync({ id: id!, requiresRemarks: false });
      }

      if (isOwner || isManager) {
        await approveSubmission.mutateAsync(id!);
        toast.success(t("app.cockpitStocktake.approved"));
      } else {
        toast.success(t("app.cockpitStocktake.submitted"));
      }

      navigate("/cockpit");
    } catch (e: any) {
      toast.error(e?.message ?? t("app.cockpitStocktake.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="min-h-screen bg-gradient-to-b from-success/5 via-background to-background">
        <div className="max-w-md mx-auto p-4 space-y-4">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="flex items-center justify-between"
          >
            <Button asChild variant="ghost" size="sm" className="-ml-2">
              <NavLink to="/cockpit">
                <ArrowLeft className="h-4 w-4 mr-1" /> {t("app.cockpitStocktake.back")}
              </NavLink>
            </Button>
            {existing && (
              <Badge
                variant={existing.status === "approved" ? "default" : "secondary"}
                className="capitalize"
              >
                {existing.status.replace("_", " ")}
              </Badge>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.05 }}
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
              <ClipboardCheck className="h-3 w-3" />
              {t("app.cockpitStocktake.dailyStocktake")}
            </div>
            <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">{t("app.cockpitStocktake.title")}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {format(today, "EEEE, d MMM yyyy")} · {t("app.cockpitStocktake.subtitleHint")} {fmt(0).replace(/[\d.,\s]/g, "")}
            </p>
          </motion.div>

          {isLoading ? (
            <Skeleton className="h-64 w-full rounded-2xl" />
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.1 }}
              className={cn(card, "p-5 space-y-4")}
            >
              <Field
                label={t("app.cockpitStocktake.opening")}
                hint={t("app.cockpitStocktake.openingHint")}
                value={opening}
                onChange={setOpening}
                disabled={isLocked}
              />
              <Field
                label={t("app.cockpitStocktake.purchases")}
                hint={t("app.cockpitStocktake.purchasesHint")}
                value={purchases}
                onChange={setPurchases}
                disabled={isLocked}
              />
              <Field
                label={t("app.cockpitStocktake.closing")}
                hint={t("app.cockpitStocktake.closingHint")}
                value={closing}
                onChange={setClosing}
                disabled={isLocked}
              />

              <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t("app.cockpitStocktake.formula")}
                  </span>
                  <span className="text-lg font-semibold tabular-nums">{fmt(cogs)}</span>
                </div>
                {sales > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{t("app.cockpitStocktake.foodCostPct")}</span>
                    <span className={cn("text-sm font-medium tabular-nums", fcStatus.color)}>
                      {fcPct.toFixed(1)}% · {fcStatus.label}
                    </span>
                  </div>
                )}
                {sales === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {t("app.cockpitStocktake.pendingHint")}
                  </p>
                )}
              </div>

              {!parsed.success && (opening || purchases || closing) && (
                <div className="flex items-start gap-2 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{parsed.error.issues[0]?.message}</span>
                </div>
              )}

              <Button
                onClick={handleSubmit}
                disabled={isLocked || saving || !parsed.success}
                className="w-full h-12 rounded-xl"
              >
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {!saving && isLocked && <CheckCircle2 className="h-4 w-4 mr-2" />}
                {isLocked
                  ? t("app.cockpitStocktake.locked")
                  : isOwner || isManager
                    ? t("app.cockpitStocktake.saveApprove")
                    : t("app.cockpitStocktake.submitApproval")}
              </Button>
            </motion.div>
          )}

          <p className="text-center text-[10px] text-muted-foreground pt-2">
            {t("app.cockpitStocktake.feedHint")}
          </p>
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <Input
        inputMode="decimal"
        type="number"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="0.00"
        className="h-12 text-base tabular-nums"
      />
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
