import { cn } from "@/lib/utils";

interface PrimeCostRingProps {
  foodCost: number;
  laborCost: number;
  target?: number;
}

export function PrimeCostRing({ foodCost, laborCost, target = 65 }: PrimeCostRingProps) {
  const primeCost = foodCost + laborCost;
  const isOverTarget = primeCost > target;
  
  const circumference = 2 * Math.PI * 45;
  const foodOffset = circumference - (foodCost / 100) * circumference;
  const laborOffset = circumference - (laborCost / 100) * circumference;
  const totalOffset = circumference - (primeCost / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center">
      <svg className="w-40 h-40 -rotate-90" viewBox="0 0 100 100">
        {/* Background circle */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="8"
        />
        
        {/* Food cost arc */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={foodOffset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
        
        {/* Labor cost arc (stacked) */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="hsl(var(--chart-2))"
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={laborOffset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
          style={{ transform: `rotate(${(foodCost / 100) * 360}deg)`, transformOrigin: "50% 50%" }}
        />
        
        {/* Glow effect when over target */}
        {isOverTarget && (
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="hsl(var(--destructive))"
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={totalOffset}
            strokeLinecap="round"
            className="progress-pulse opacity-30"
            filter="blur(4px)"
          />
        )}
      </svg>
      
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn(
          "text-3xl font-semibold",
          isOverTarget ? "text-destructive" : "text-foreground"
        )}>
          {primeCost.toFixed(1)}%
        </span>
        <span className="text-xs text-muted-foreground">Prime Cost</span>
      </div>
    </div>
  );
}

export function PrimeCostLegend({ foodCost, laborCost }: { foodCost: number; laborCost: number }) {
  return (
    <div className="flex items-center justify-center gap-6 mt-4">
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-primary" />
        <span className="text-sm text-muted-foreground">
          Food <span className="font-medium text-foreground">{foodCost}%</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-chart-2" />
        <span className="text-sm text-muted-foreground">
          Labor <span className="font-medium text-foreground">{laborCost}%</span>
        </span>
      </div>
    </div>
  );
}
