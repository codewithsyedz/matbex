import { cn } from "@/lib/utils";

interface HealthBarProps {
  label: string;
  value: number;
  maxValue?: number;
  target?: number;
  unit?: string;
  colorScheme?: "default" | "inverse";
}

export function HealthBar({
  label,
  value,
  maxValue = 100,
  target,
  unit = "%",
  colorScheme = "default",
}: HealthBarProps) {
  const percentage = Math.min((value / maxValue) * 100, 100);
  
  const getBarColor = () => {
    if (colorScheme === "inverse") {
      if (percentage > 75) return "bg-destructive";
      if (percentage > 50) return "bg-warning";
      return "bg-success";
    }
    if (percentage >= 80) return "bg-success";
    if (percentage >= 50) return "bg-warning";
    return "bg-destructive";
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">
          {value}{unit}
          {target && <span className="text-xs ml-1">/ {target}{unit}</span>}
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            getBarColor()
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
