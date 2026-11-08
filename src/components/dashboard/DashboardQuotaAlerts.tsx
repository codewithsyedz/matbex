import { useQuota, QuotaLimits } from "@/hooks/useQuota";
import { QuotaAlert } from "@/components/quota";

/**
 * Displays quota alerts on the dashboard for any quotas approaching or at their limits.
 * Only shows alerts when usage is >= 80% of limit.
 */
export function DashboardQuotaAlerts() {
  const { usage, quotaLimits, getUsagePercentage } = useQuota();

  if (!usage || Object.keys(quotaLimits).length === 0) {
    return null;
  }

  // Quota types to check on dashboard
  const quotaTypes: (keyof QuotaLimits)[] = [
    "users",
    "menu_items",
    "image_uploads",
    "email_reminders",
  ];

  // Filter to only show quotas that are near or at limit
  const alertQuotas = quotaTypes.filter((type) => {
    const percentage = getUsagePercentage(type);
    return percentage !== null && percentage >= 80;
  });

  if (alertQuotas.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {alertQuotas.map((quotaType) => (
        <QuotaAlert key={quotaType} quotaType={quotaType} />
      ))}
    </div>
  );
}