import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuota, QuotaLimits, TenantUsage } from "@/hooks/useQuota";
import { Users, UtensilsCrossed, Image, Mail, ArrowUpCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface QuotaItemProps {
  label: string;
  current: number;
  limit: number | undefined;
  icon: React.ReactNode;
}

function QuotaItem({ label, current, limit, icon }: QuotaItemProps) {
  if (!limit) return null;

  const percentage = Math.min(100, Math.round((current / limit) * 100));
  const isAtLimit = current >= limit;
  const isNearLimit = percentage >= 80 && !isAtLimit;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {current} / {limit}
          </span>
          {isAtLimit && (
            <Badge variant="destructive" className="text-xs">
              Limit
            </Badge>
          )}
          {isNearLimit && (
            <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              {percentage}%
            </Badge>
          )}
        </div>
      </div>
      <Progress
        value={percentage}
        className={`h-2 ${
          isAtLimit
            ? "[&>div]:bg-destructive"
            : isNearLimit
            ? "[&>div]:bg-amber-500"
            : ""
        }`}
      />
    </div>
  );
}

export function QuotaUsageCard() {
  const navigate = useNavigate();
  const { usage, quotaLimits } = useQuota();

  if (!usage || Object.keys(quotaLimits).length === 0) {
    return null;
  }

  const hasAnyLimit = Object.values(quotaLimits).some((v) => v !== undefined);
  if (!hasAnyLimit) return null;

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-medium">Plan Usage</CardTitle>
            <CardDescription>Your current usage against plan limits</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/billing")}>
            <ArrowUpCircle className="h-4 w-4 mr-2" />
            Upgrade
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <QuotaItem
          label="Team Members"
          current={usage.user_count}
          limit={quotaLimits.users}
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
        />
        <QuotaItem
          label="Menu Items"
          current={usage.menu_item_count}
          limit={quotaLimits.menu_items}
          icon={<UtensilsCrossed className="h-4 w-4 text-muted-foreground" />}
        />
        <QuotaItem
          label="Image Uploads"
          current={usage.image_upload_count}
          limit={quotaLimits.image_uploads}
          icon={<Image className="h-4 w-4 text-muted-foreground" />}
        />
        <QuotaItem
          label="Email Reminders"
          current={usage.email_reminder_count}
          limit={quotaLimits.email_reminders}
          icon={<Mail className="h-4 w-4 text-muted-foreground" />}
        />

        {/* Role-specific limits */}
        {quotaLimits.owner && (
          <QuotaItem
            label="Owners"
            current={usage.owner_count}
            limit={quotaLimits.owner}
            icon={<Users className="h-4 w-4 text-muted-foreground" />}
          />
        )}
        {quotaLimits.manager && (
          <QuotaItem
            label="Managers"
            current={usage.manager_count}
            limit={quotaLimits.manager}
            icon={<Users className="h-4 w-4 text-muted-foreground" />}
          />
        )}
        {quotaLimits.cashier && (
          <QuotaItem
            label="Cashiers"
            current={usage.cashier_count}
            limit={quotaLimits.cashier}
            icon={<Users className="h-4 w-4 text-muted-foreground" />}
          />
        )}
      </CardContent>
    </Card>
  );
}
