import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useQuota, QuotaLimits } from "@/hooks/useQuota";
import { Info, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface QuotaInfoCardProps {
  quotaType: keyof QuotaLimits;
  label?: string;
  className?: string;
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

export function QuotaInfoCard({
  quotaType,
  label,
  className,
}: QuotaInfoCardProps) {
  const { usage, quotaLimits, getUsagePercentage } = useQuota();

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
  const remaining = Math.max(0, limit - current);

  const displayLabel = label || quotaLabels[quotaType];

  // Determine status styling
  const getStatusConfig = () => {
    if (isAtLimit) {
      return {
        icon: XCircle,
        iconColor: "text-destructive",
        progressColor: "[&>div]:bg-destructive",
        badge: "destructive" as const,
        badgeText: "At Limit",
      };
    }
    if (isNearLimit) {
      return {
        icon: AlertTriangle,
        iconColor: "text-amber-500",
        progressColor: "[&>div]:bg-amber-500",
        badge: "outline" as const,
        badgeText: "Near Limit",
      };
    }
    return {
      icon: Info,
      iconColor: "text-muted-foreground",
      progressColor: "[&>div]:bg-primary",
      badge: null,
      badgeText: null,
    };
  };

  const status = getStatusConfig();
  const Icon = status.icon;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Icon className={cn("h-4 w-4", status.iconColor)} />
            <span className="text-sm font-medium">{displayLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            {status.badge && (
              <Badge variant={status.badge} className="text-xs">
                {status.badgeText}
              </Badge>
            )}
            <span className="text-sm text-muted-foreground">
              {remaining} left
            </span>
          </div>
        </div>
        
        <div className="space-y-1.5">
          <Progress
            value={percentage}
            className={cn("h-2", status.progressColor)}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {current} / {limit} used
            </span>
            <span>{percentage}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
