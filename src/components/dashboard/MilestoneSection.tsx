import { useDailyProfit } from "@/hooks/useDailyProfit";
import { LazyMilestoneCelebration } from "./lazySections";

/**
 * Isolates `useDailyProfit` (a large fan-out of ~15 queries) into its own
 * component so it only runs when this section actually mounts. Previously it
 * ran on every dashboard mount purely to feed the milestone banner, competing
 * with the above-the-fold KPI queries and stalling first paint.
 */
export function MilestoneSection() {
  const { streaks, today: todayProfit, weekData } = useDailyProfit();

  return (
    <LazyMilestoneCelebration
      streaks={streaks}
      currentDayProfit={todayProfit?.operatingProfit || 0}
      weeklyProfitable={weekData.length >= 7 && weekData.every((d) => d.operatingProfit > 0)}
    />
  );
}
