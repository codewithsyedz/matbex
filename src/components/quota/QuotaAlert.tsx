import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, ArrowUpCircle, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useQuota, QuotaLimits } from "@/hooks/useQuota";

export interface QuotaAlertProps {
  quotaType: keyof QuotaLimits;
  label?: string;
  dismissable?: boolean;
}

const quotaLabels: Record<keyof QuotaLimits, string> = {
  users: "Team Members",
  owner: "Owners",
  manager: "Managers",
  cashier: "Cashiers",
  menu_items: "Menu Items",
  image_uploads: "Image Uploads",
  email_reminders: "Email Reminders",
};

export function QuotaAlert({
  quotaType,
  label,
  dismissable = true,
}: QuotaAlertProps) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const { usage, quotaLimits, getUsagePercentage } = useQuota();

  useEffect(() => {
    if (dismissed) return;
    const t = setTimeout(() => setDismissed(true), 5000);
    return () => clearTimeout(t);
  }, [dismissed]);

  if (dismissed) return null;

  const limit = quotaLimits[quotaType];
  if (!limit || !usage) return null;

  const usageMap: Record<keyof QuotaLimits, string> = {
    users: "user_count",
    owner: "owner_count",
    manager: "manager_count",
    cashier: "cashier_count",
    menu_items: "menu_item_count",
    image_uploads: "image_upload_count",
    email_reminders: "email_reminder_count",
  };

  const current = (usage as any)[usageMap[quotaType]] || 0;
  const percentage = getUsagePercentage(quotaType) || 0;
  const isAtLimit = current >= limit;
  const isNearLimit = percentage >= 80 && !isAtLimit;

  if (!isNearLimit && !isAtLimit) return null;

  const displayLabel = label || quotaLabels[quotaType];

  return (
    <Alert
      variant={isAtLimit ? "destructive" : "default"}
      className={`relative ${isAtLimit ? "" : "border-amber-500 bg-amber-50 dark:bg-amber-950/20"}`}
    >
      {dismissable && (
        <button
          onClick={() => setDismissed(true)}
          className="absolute right-2 top-2 p-1 rounded-md hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      <AlertTriangle className={`h-4 w-4 ${isAtLimit ? "" : "text-amber-500"}`} />
      <AlertTitle className="pr-8">
        {isAtLimit ? `${displayLabel} Limit Reached` : `${displayLabel} Limit Almost Reached`}
      </AlertTitle>
      <AlertDescription className="mt-2 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span>
            {current} / {limit} {displayLabel.toLowerCase()} used
          </span>
          <span className="font-medium">{percentage}%</span>
        </div>
        <Progress
          value={percentage}
          className={`h-2 ${isAtLimit ? "[&>div]:bg-destructive" : "[&>div]:bg-amber-500"}`}
        />
        <p className="text-sm">
          {isAtLimit
            ? `You've reached your ${displayLabel.toLowerCase()} limit. Upgrade your plan to continue adding more.`
            : `You're approaching your ${displayLabel.toLowerCase()} limit. Consider upgrading to avoid interruptions.`}
        </p>
        <Button
          size="sm"
          variant={isAtLimit ? "default" : "outline"}
          onClick={() => navigate("/billing")}
          className="mt-2"
        >
          <ArrowUpCircle className="h-4 w-4 mr-2" />
          Upgrade Plan
        </Button>
      </AlertDescription>
    </Alert>
  );
}