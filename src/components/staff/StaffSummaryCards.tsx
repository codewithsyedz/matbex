import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useBranch } from "@/contexts/BranchContext";
import { Card, CardContent } from "@/components/ui/card";
import { StaffSummaryCardsSkeleton } from "@/components/staff/StaffSkeletons";
import { Users, DollarSign, Calendar, TrendingUp } from "lucide-react";
import { calculateMonthlyPayroll } from "@/lib/staffUtils";
import { useTranslation } from "react-i18next";

interface Staff {
  id: string;
  is_active: boolean;
  payment_type: string;
  monthly_salary: number | null;
  hourly_rate: number;
  assigned_branch_id?: string | null;
}

interface PayrollRecord {
  id: string;
  amount: number;
  payment_date: string;
  branch_id?: string | null;
}

interface StaffSettings {
  salary_day: number;
  include_payroll_in_overhead: boolean;
}

export function StaffSummaryCards() {
  const { restaurant } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const { activeBranchId, isAllBranches } = useBranch();
  const { t } = useTranslation();

  const { data: staffList, isLoading: staffLoading } = useQuery({
    queryKey: ["staff-summary", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("staff")
        .select("id, is_active, payment_type, monthly_salary, hourly_rate, assigned_branch_id")
        .eq("restaurant_id", restaurant.id);

      if (error) throw error;
      return data as Staff[];
    },
    enabled: !!restaurant?.id,
  });

  const { data: payrollRecords, isLoading: payrollLoading } = useQuery({
    queryKey: ["payroll", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("payroll_records")
        .select("id, amount, payment_date, branch_id")
        .eq("restaurant_id", restaurant.id);

      if (error) throw error;
      return data as PayrollRecord[];
    },
    enabled: !!restaurant?.id,
  });

  const { data: settings } = useQuery({
    queryKey: ["staff-settings", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return null;
      const { data, error } = await supabase
        .from("staff_settings")
        .select("salary_day, include_payroll_in_overhead")
        .eq("restaurant_id", restaurant.id)
        .maybeSingle();

      if (error) throw error;
      return data as StaffSettings | null;
    },
    enabled: !!restaurant?.id,
  });

  const isLoading = staffLoading || payrollLoading;

  if (isLoading) {
    return <StaffSummaryCardsSkeleton />;
  }

  // Branch scope: managers may pick "All" (isAllBranches). Otherwise show
  // staff pinned to the branch + unpinned "shared" staff, and payroll
  // records tagged with that branch (or untagged legacy).
  const scopedStaff = (staffList || []).filter((s) => {
    if (isAllBranches || !activeBranchId) return true;
    return !s.assigned_branch_id || s.assigned_branch_id === activeBranchId;
  });
  const scopedPayroll = (payrollRecords || []).filter((r) => {
    if (isAllBranches || !activeBranchId) return true;
    return !r.branch_id || r.branch_id === activeBranchId;
  });
  const activeStaff = scopedStaff.filter((s) => s.is_active);
  const totalActiveStaff = activeStaff.length;

  // Calculate monthly payroll from staff salaries (using utility function for consistency)
  const monthlyPayroll = calculateMonthlyPayroll(activeStaff);

  // Daily overhead is standardized as monthly payroll / 30 (consistent with Daily Profit overhead allocation)
  const dailyPayrollOverhead = monthlyPayroll / 30;

  // Total paid this month
  const now = new Date();
  const paidThisMonth = scopedPayroll
    .filter((r) => {
      if (!r.payment_date) return false;
      const paymentDate = new Date(r.payment_date);
      if (isNaN(paymentDate.getTime())) return false;
      return (
        paymentDate.getMonth() === now.getMonth() &&
        paymentDate.getFullYear() === now.getFullYear()
      );
    })
    .reduce((sum, r) => sum + r.amount, 0);

  // Days until salary day
  const salaryDay = settings?.salary_day || 1;
  const currentDay = now.getDate();
  let daysUntilSalary = salaryDay - currentDay;
  if (daysUntilSalary < 0) {
    // Next month
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    daysUntilSalary = daysInMonth - currentDay + salaryDay;
  }

  const cards = [
    {
      title: t("app.staff.summary.activeStaff"),
      value: totalActiveStaff.toString(),
      description: t("app.staff.summary.total", { count: scopedStaff.length }),
      icon: Users,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      title: t("app.staff.summary.monthlyPayroll"),
      value: formatCurrency(monthlyPayroll),
      description: settings?.include_payroll_in_overhead ? t("app.staff.summary.inOverhead") : t("app.staff.summary.notInOverhead"),
      icon: DollarSign,
      color: "text-success",
      bgColor: "bg-success/10",
    },
    {
      title: t("app.staff.summary.dailyOverhead"),
      value: formatCurrency(dailyPayrollOverhead),
      description: t("app.staff.summary.payrollPerDay"),
      icon: TrendingUp,
      color: "text-warning",
      bgColor: "bg-warning/10",
    },
    {
      title: t("app.staff.summary.nextSalaryDay"),
      value: daysUntilSalary === 0 ? t("time.today") : t("app.staff.summary.days", { count: daysUntilSalary }),
      description: t("app.staff.summary.dayOfMonth", { day: salaryDay }),
      icon: Calendar,
      color: "text-muted-foreground",
      bgColor: "bg-muted",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
      {cards.map((card, i) => (
        <Card key={i} className="fade-slide-in" style={{ animationDelay: `${i * 50}ms` }}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 md:gap-3 lg:gap-4">
              <div className={`p-2 md:p-3 rounded-lg shrink-0 ${card.bgColor}`}>
                <card.icon className={`h-4 w-4 md:h-5 md:w-5 ${card.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-xs md:text-sm text-muted-foreground truncate">{card.title}</p>
                <p className="text-base md:text-lg lg:text-2xl font-semibold truncate">{card.value}</p>
                <p className="text-[10px] md:text-xs text-muted-foreground truncate">{card.description}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
