import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Database,
  FileCheck2,
  Infinity as InfinityIcon,
  ShieldCheck,
  Users,
} from "lucide-react";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoTrial } from "@/hooks/useDemoTrial";
import { useFunnelTracker } from "@/hooks/useFunnelTracker";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ActivationUpgradeDialog({ open, onOpenChange }: Props) {
  const { tenant } = useAuth();
  const { daysLeft } = useDemoTrial();
  const { track } = useFunnelTracker();
  const [busy, setBusy] = useState(false);

  const handleActivate = async () => {
    if (!tenant?.id) return;
    setBusy(true);
    track("upgrade_clicked", { days_left: daysLeft });
    try {
      const { error } = await db.functions.invoke("activate-demo-tenant", {
        body: { tenant_id: tenant.id },
      });
      if (error) throw error;
      toast.success("Account activated. Welcome to Matbex.");
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.message || "Activation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <Badge variant="outline" className="w-fit border-emerald-300 bg-emerald-50 text-emerald-700">
            Activate Matbex
          </Badge>
          <DialogTitle className="text-2xl">Go live today. Zero friction.</DialogTitle>
          <DialogDescription>
            No reset, no migration, no reconfiguration. Everything you've set up moves with you.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border bg-muted/30 p-4">
            <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              What stays
            </h4>
            <ul className="space-y-2 text-sm">
              <Row icon={Database}>All your data - orders, products, customers</Row>
              <Row icon={Users}>Users, roles and permissions</Row>
              <Row icon={CheckCircle2}>Branches, taxes and menu configuration</Row>
            </ul>
          </section>

          <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
            <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-700">
              What unlocks
            </h4>
            <ul className="space-y-2 text-sm">
              <Row icon={CreditCard} accent>HyperPay, Mada and live payments</Row>
              <Row icon={FileCheck2} accent>ZATCA-compliant e-invoicing</Row>
              <Row icon={InfinityIcon} accent>Unlimited branches and full exports</Row>
              <Row icon={ShieldCheck} accent>Production SLAs and priority support</Row>
            </ul>
          </section>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Keep exploring
          </Button>
          <Button onClick={handleActivate} disabled={busy}>
            {busy ? "Activating…" : "Activate Matbex"}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  icon: Icon,
  accent,
  children,
}: {
  icon: any;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${accent ? "text-emerald-600" : "text-muted-foreground"}`} />
      <span>{children}</span>
    </li>
  );
}