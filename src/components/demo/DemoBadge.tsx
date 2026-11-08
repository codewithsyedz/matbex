import { Badge } from "@/components/ui/badge";
import { FlaskConical } from "lucide-react";

export function DemoBadge({ className = "" }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={`gap-1 border-amber-300/60 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 ${className}`}
    >
      <FlaskConical className="h-3 w-3" />
      Demo Environment
    </Badge>
  );
}

export function SampleDataLabel({ className = "" }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={`text-[10px] uppercase tracking-wider border-amber-300/60 bg-amber-50/60 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 ${className}`}
    >
      Sample Data
    </Badge>
  );
}