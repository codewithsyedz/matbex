import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { cn } from "@/lib/utils";
import { Trophy, Target, Flame, Sparkles, X, Star, TrendingUp, Calendar, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Milestone {
  type: string;
  value: number;
  label: string;
  description: string;
  icon: typeof Trophy;
}

const MILESTONES: Milestone[] = [
  // Streak milestones
  { type: "profit_streak_3", value: 3, label: "3-Day Healthy Profit Streak!", description: "Three consecutive profitable days", icon: Flame },
  { type: "profit_streak_7", value: 7, label: "7-Day Healthy Profit Streak!", description: "A full week of healthy profits", icon: Trophy },
  { type: "prime_cost_target_5", value: 5, label: "5 Days Under Prime Cost Target!", description: "Cost control mastery", icon: Target },
  { type: "prime_cost_target_10", value: 10, label: "10 Days Under Prime Cost Target!", description: "Exceptional cost discipline", icon: Sparkles },
  
  // First-time achievements
  { type: "first_profitable_week", value: 1, label: "First Profitable Week!", description: "7 days of positive operating profit", icon: Star },
  { type: "first_profitable_month", value: 1, label: "First Profitable Month!", description: "30 days of sustained success", icon: Crown },
  
  // Performance milestones
  { type: "highest_profit_day", value: 1, label: "New Highest Profit Day!", description: "You've set a new record", icon: TrendingUp },
  { type: "monthly_target_hit", value: 1, label: "Monthly Target Achieved!", description: "Goal accomplished", icon: Calendar },
];

interface MilestoneCelebrationProps {
  streaks: {
    healthyMarginDays: number;
    primeCostTargetDays: number;
  };
  highestProfitDay?: number;
  currentDayProfit?: number;
  weeklyProfitable?: boolean;
  monthlyProfitable?: boolean;
}

export function MilestoneCelebration({ 
  streaks, 
  highestProfitDay = 0, 
  currentDayProfit = 0,
  weeklyProfitable = false,
  monthlyProfitable = false,
}: MilestoneCelebrationProps) {
  const { restaurant } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const [showCelebration, setShowCelebration] = useState(false);
  const [currentMilestone, setCurrentMilestone] = useState<Milestone | null>(null);
  const [celebrationQueue, setCelebrationQueue] = useState<Milestone[]>([]);

  // Fetch existing milestones
  const { data: achievedMilestones } = useQuery({
    queryKey: ["profit-milestones", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("profit_milestones")
        .select("milestone_type, milestone_value, achieved_at")
        .eq("restaurant_id", restaurant.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id,
  });

  // Create milestone mutation
  const createMilestoneMutation = useMutation({
    mutationFn: async (milestone: { type: string; value: number }) => {
      if (!restaurant?.id) throw new Error("No restaurant");
      const { error } = await db
        .from("profit_milestones")
        .insert({
          restaurant_id: restaurant.id,
          milestone_type: milestone.type,
          milestone_value: milestone.value,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profit-milestones"] });
    },
  });

  // Check for new milestones
  useEffect(() => {
    if (!achievedMilestones) return;

    const newMilestones: Milestone[] = [];

    const checkMilestones: { check: boolean; milestone: Milestone }[] = [
      // Streak milestones
      { check: streaks.healthyMarginDays >= 3, milestone: MILESTONES.find(m => m.type === "profit_streak_3")! },
      { check: streaks.healthyMarginDays >= 7, milestone: MILESTONES.find(m => m.type === "profit_streak_7")! },
      { check: streaks.primeCostTargetDays >= 5, milestone: MILESTONES.find(m => m.type === "prime_cost_target_5")! },
      { check: streaks.primeCostTargetDays >= 10, milestone: MILESTONES.find(m => m.type === "prime_cost_target_10")! },
      
      // Weekly/Monthly milestones
      { check: weeklyProfitable, milestone: MILESTONES.find(m => m.type === "first_profitable_week")! },
      { check: monthlyProfitable, milestone: MILESTONES.find(m => m.type === "first_profitable_month")! },
      
      // Highest profit day (check if current day beats previous high)
      { 
        check: currentDayProfit > 0 && currentDayProfit > highestProfitDay, 
        milestone: MILESTONES.find(m => m.type === "highest_profit_day")! 
      },
    ];

    for (const { check, milestone } of checkMilestones) {
      if (milestone && check && !achievedMilestones.some(m => m.milestone_type === milestone.type)) {
        newMilestones.push(milestone);
      }
    }

    if (newMilestones.length > 0 && !showCelebration) {
      // Queue all new milestones
      setCelebrationQueue(newMilestones);
      showNextMilestone(newMilestones);
    }
  }, [streaks, achievedMilestones, weeklyProfitable, monthlyProfitable, currentDayProfit, highestProfitDay]);

  const showNextMilestone = (queue: Milestone[]) => {
    if (queue.length === 0) return;
    
    const next = queue[0];
    setCurrentMilestone(next);
    setShowCelebration(true);
    createMilestoneMutation.mutate({ type: next.type, value: next.value });
  };

  const dismissCelebration = () => {
    setShowCelebration(false);
    
    setTimeout(() => {
      const remaining = celebrationQueue.slice(1);
      setCelebrationQueue(remaining);
      
      if (remaining.length > 0) {
        setTimeout(() => showNextMilestone(remaining), 300);
      } else {
        setCurrentMilestone(null);
      }
    }, 300);
  };

  if (!showCelebration || !currentMilestone) return null;

  const Icon = currentMilestone.icon;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center pointer-events-none",
        showCelebration ? "animate-fade-in" : "animate-fade-out"
      )}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm pointer-events-auto" onClick={dismissCelebration} />
      
      {/* Celebration Card */}
      <div
        className={cn(
          "relative bg-card border rounded-2xl p-8 max-w-sm mx-4 pointer-events-auto shadow-2xl",
          "animate-scale-in"
        )}
      >
        {/* Close button */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 h-8 w-8"
          onClick={dismissCelebration}
        >
          <X className="h-4 w-4" />
        </Button>

        {/* Glowing Icon */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/30 rounded-full blur-xl animate-pulse" />
            <div className="relative p-4 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 border border-primary/30">
              <Icon className="h-12 w-12 text-primary animate-bounce-gentle" />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="text-center space-y-2">
          <h3 className="text-xl font-semibold text-foreground">Milestone Achieved!</h3>
          <p className="text-lg text-primary font-medium">{currentMilestone.label}</p>
          <p className="text-sm text-muted-foreground pt-2">
            {currentMilestone.description}
          </p>
        </div>

        {/* Dismiss */}
        <div className="mt-6">
          <Button className="w-full" onClick={dismissCelebration}>
            <Sparkles className="h-4 w-4 mr-2" />
            Continue
          </Button>
        </div>

        {/* Confetti particles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[...Array(12)].map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 rounded-full"
              style={{
                backgroundColor: i % 3 === 0 ? "hsl(var(--primary))" : i % 3 === 1 ? "hsl(var(--success))" : "hsl(var(--warning))",
                left: `${10 + Math.random() * 80}%`,
                top: `${10 + Math.random() * 80}%`,
                animation: `confetti-${i % 4} ${1 + Math.random() * 2}s ease-out forwards`,
                animationDelay: `${Math.random() * 0.5}s`,
              }}
            />
          ))}
        </div>
      </div>

      {/* CSS for confetti animation */}
      <style>{`
        @keyframes confetti-0 {
          0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
          100% { transform: translate(-30px, -60px) rotate(180deg); opacity: 0; }
        }
        @keyframes confetti-1 {
          0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
          100% { transform: translate(30px, -50px) rotate(-180deg); opacity: 0; }
        }
        @keyframes confetti-2 {
          0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
          100% { transform: translate(-20px, -70px) rotate(270deg); opacity: 0; }
        }
        @keyframes confetti-3 {
          0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
          100% { transform: translate(25px, -55px) rotate(-270deg); opacity: 0; }
        }
        @keyframes bounce-gentle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        .animate-bounce-gentle {
          animation: bounce-gentle 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
