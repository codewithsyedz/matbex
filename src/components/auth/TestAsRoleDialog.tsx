import { useState } from "react";
import { useAuth, type ImpersonatableRole } from "@/contexts/AuthContext";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Calculator, Coins, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface TestAsRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ROLE_OPTIONS: Array<{
  value: ImpersonatableRole;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: "manager",
    label: "Manager",
    description: "Day-to-day operations, sales, inventory, team. Cannot manage billing or owner-only settings.",
    icon: ShieldCheck,
  },
  {
    value: "accountant",
    label: "Accountant",
    description: "Read-only on accounting by default. Can post journals only if you've enabled that permission.",
    icon: Calculator,
  },
  {
    value: "cashier",
    label: "Cashier",
    description: "Locked to Record Sale and Shifts. Verifies the front-of-house experience.",
    icon: Coins,
  },
];

export function TestAsRoleDialog({ open, onOpenChange }: TestAsRoleDialogProps) {
  const { startRoleImpersonation, canImpersonateRoles } = useAuth();
  const impersonationEnabled = useFeatureFlag("impersonation_enabled", true);
  const [selected, setSelected] = useState<ImpersonatableRole | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!canImpersonateRoles) return null;

  const handleStart = async () => {
    if (!selected) return;
    setSubmitting(true);
    const { error } = await startRoleImpersonation(selected);
    setSubmitting(false);
    if (error) {
      toast.error(error.message || "Could not start impersonation");
      return;
    }
    toast.success(`Now testing as ${selected.charAt(0).toUpperCase()}${selected.slice(1)}`);
    onOpenChange(false);
    setSelected(null);
    // Reload so guarded routes and menus re-evaluate cleanly.
    setTimeout(() => window.location.assign("/dashboard"), 100);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Test as another role</DialogTitle>
          <DialogDescription>
            See exactly what a Manager, Accountant, or Cashier sees. Every session is logged for audit.
            Database writes are still recorded under your real owner account.
          </DialogDescription>
        </DialogHeader>

        {!impersonationEnabled && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Test as… is temporarily disabled by the platform administrator. Please try again later.
          </div>
        )}

        <div className="space-y-2 py-2">
          {ROLE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = selected === opt.value;
            return (
              <button
                type="button"
                key={opt.value}
                onClick={() => setSelected(opt.value)}
                className={cn(
                  "w-full text-left rounded-lg border p-3 transition-colors flex gap-3 items-start",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40 hover:bg-accent"
                )}
              >
                <Icon className={cn("h-5 w-5 mt-0.5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{opt.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
                </div>
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleStart}
            disabled={!selected || submitting || !impersonationEnabled}
            title={!impersonationEnabled ? "Disabled by platform administrator" : undefined}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Start session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}