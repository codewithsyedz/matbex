import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format } from "date-fns";

// Stock categories from PRD
export const STOCK_CATEGORIES = [
  { value: 'flour_atta', label: 'Flour / Atta' },
  { value: 'rice', label: 'Rice' },
  { value: 'meat_chicken', label: 'Meat / Chicken' },
  { value: 'oil_ghee', label: 'Oil / Ghee' },
  { value: 'vegetables', label: 'Vegetables' },
  { value: 'dairy_laban', label: 'Dairy / Laban' },
  { value: 'spices_condiments', label: 'Spices / Condiments' },
  { value: 'ready_mix', label: 'Ready Mix / Semi-Prep' },
  { value: 'other', label: 'Other' },
] as const;

export const ITEM_TYPES = STOCK_CATEGORIES;

export const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'credit', label: 'Credit' },
  { value: 'transfer', label: 'Transfer' },
] as const;

export const SHIFT_TYPES = [
  { value: 'morning', label: 'Morning Shift' },
  { value: 'evening', label: 'Evening Shift' },
  { value: 'night', label: 'Night Shift' },
  { value: 'full', label: 'Full Day' },
] as const;

export const EXCEPTION_REASONS = [
  { value: 'wastage_spoilage', label: 'Wastage / Spoilage' },
  { value: 'free_staff_meals', label: 'Free / Staff Meals' },
  { value: 'theft_suspected', label: 'Theft Suspected' },
  { value: 'over_portioning', label: 'Over-portioning' },
  { value: 'market_price_increase', label: 'Market Price Increase' },
  { value: 'entry_error', label: 'Entry Error' },
  { value: 'other', label: 'Other' },
] as const;

export interface COGSSubmission {
  id: string;
  restaurant_id: string;
  shift_id: string | null;
  shift_template_id: string | null;
  submission_date: string;
  shift_type: string;
  cashier_user_id: string;
  cashier_name: string;
  kitchen_incharge_name: string | null;
  kitchen_verified_at: string | null;
  opening_stock_value: number;
  closing_stock_value: number;
  purchases_value: number;
  cash_sales: number;
  card_sales: number;
  online_sales: number;
  total_sales: number;
  cogs: number;
  food_cost_percentage: number;
  theoretical_cogs: number | null;
  variance_value: number | null;
  variance_percentage: number | null;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'correction_requested';
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  cashier_signature_at: string | null;
  kitchen_signature_at: string | null;
  manager_signature_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface COGSStockItem {
  id: string;
  submission_id: string;
  stock_type: 'opening' | 'closing';
  category: string;
  category_label: string;
  amount: number;
  notes: string | null;
  created_at: string;
}

export interface COGSPurchase {
  id: string;
  submission_id: string;
  supplier_name: string | null;
  invoice_number: string | null;
  payment_mode: 'cash' | 'credit' | 'transfer';
  item_type: string;
  amount: number;
  missing_bill: boolean;
  notes: string | null;
  entered_by: string;
  created_at: string;
}

export interface COGSExceptionLog {
  id: string;
  submission_id: string;
  exception_type: string;
  reason_code: string;
  reason_label: string;
  remarks: string;
  logged_by: string;
  created_at: string;
}

// Thresholds from PRD
const FOOD_COST_WARNING_THRESHOLD = 41;
const FOOD_COST_CRITICAL_THRESHOLD = 45;
const PURCHASE_VARIANCE_THRESHOLD = 30; // % above historical average

export function useCOGSSubmissions(dateFilter?: { from: Date; to: Date }) {
  const { restaurant, user, profile } = useAuth();
  const queryClient = useQueryClient();

  // Fetch submissions for date range
  const { data: submissions, isLoading: submissionsLoading } = useQuery({
    queryKey: ["cogs-submissions", restaurant?.id, dateFilter?.from, dateFilter?.to],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      
      let query = db
        .from("daily_cogs_submissions")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("submission_date", { ascending: false });
      
      if (dateFilter?.from) {
        query = query.gte("submission_date", format(dateFilter.from, "yyyy-MM-dd"));
      }
      if (dateFilter?.to) {
        query = query.lte("submission_date", format(dateFilter.to, "yyyy-MM-dd"));
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as COGSSubmission[];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch pending submissions for manager review
  const { data: pendingApprovals, isLoading: pendingLoading } = useQuery({
    queryKey: ["cogs-pending-approvals", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      
      const { data, error } = await db
        .from("daily_cogs_submissions")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("status", "submitted")
        .order("submitted_at", { ascending: true });
      
      if (error) throw error;
      return (data || []) as COGSSubmission[];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch historical stats for anomaly detection
  const { data: historicalStats } = useQuery({
    queryKey: ["cogs-historical-stats", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return null;
      
      const { data, error } = await db
        .from("cogs_historical_stats")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("stat_date", { ascending: false })
        .limit(1)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    enabled: !!restaurant?.id,
  });

  // Create new submission
  const createSubmission = useMutation({
    mutationFn: async (data: {
      submission_date: string;
      shift_type: string;
      shift_id?: string;
      shift_template_id?: string;
    }) => {
      if (!restaurant?.id || !user?.id) throw new Error("Not authenticated");
      
      // Check for existing submission
      const { data: existing } = await db
        .from("daily_cogs_submissions")
        .select("id")
        .eq("restaurant_id", restaurant.id)
        .eq("submission_date", data.submission_date)
        .eq("shift_type", data.shift_type)
        .single();
      
      if (existing) {
        throw new Error("A submission for this date and shift already exists");
      }
      
      const { data: result, error } = await db
        .from("daily_cogs_submissions")
        .insert({
          restaurant_id: restaurant.id,
          submission_date: data.submission_date,
          shift_type: data.shift_type,
          shift_id: data.shift_id || null,
          shift_template_id: data.shift_template_id || null,
          cashier_user_id: user.id,
          cashier_name: profile?.full_name || user.email || "Unknown",
          status: "draft",
        })
        .select()
        .single();
      
      if (error) throw error;
      return result as COGSSubmission;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cogs-submissions"] });
      toast.success("COGS submission created");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Update submission values
  const updateSubmission = useMutation({
    mutationFn: async (data: {
      id: string;
      opening_stock_value?: number;
      closing_stock_value?: number;
      purchases_value?: number;
      cash_sales?: number;
      card_sales?: number;
      online_sales?: number;
      kitchen_incharge_name?: string;
      kitchen_verified_at?: string;
    }) => {
      const { id, ...updates } = data;
      
      const { data: result, error } = await db
        .from("daily_cogs_submissions")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return result as COGSSubmission;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cogs-submissions"] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Submit for approval
  const submitForApproval = useMutation({
    mutationFn: async (data: { id: string; requiresRemarks: boolean; remarks?: string; reasonCode?: string }) => {
      if (!user?.id) throw new Error("Not authenticated");
      
      // If food cost > 45%, remarks are mandatory
      if (data.requiresRemarks && (!data.remarks || !data.reasonCode)) {
        throw new Error("Remarks are required when Food Cost % exceeds 45%");
      }
      
      // Log exception if needed
      if (data.remarks && data.reasonCode) {
        const reason = EXCEPTION_REASONS.find(r => r.value === data.reasonCode);
        await db.from("cogs_exception_logs").insert({
          submission_id: data.id,
          exception_type: "high_food_cost",
          reason_code: data.reasonCode,
          reason_label: reason?.label || data.reasonCode,
          remarks: data.remarks,
          logged_by: user.id,
        });
      }
      
      const { data: result, error } = await db
        .from("daily_cogs_submissions")
        .update({
          status: "submitted",
          submitted_at: new Date().toISOString(),
          cashier_signature_at: new Date().toISOString(),
        })
        .eq("id", data.id)
        .select()
        .single();
      
      if (error) throw error;
      return result as COGSSubmission;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cogs-submissions"] });
      queryClient.invalidateQueries({ queryKey: ["cogs-pending-approvals"] });
      toast.success("COGS submission sent for approval");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Manager approval
  const approveSubmission = useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error("Not authenticated");
      
      const { data: result, error } = await db
        .from("daily_cogs_submissions")
        .update({
          status: "approved",
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          manager_signature_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return result as COGSSubmission;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cogs-submissions"] });
      queryClient.invalidateQueries({ queryKey: ["cogs-pending-approvals"] });
      toast.success("COGS submission approved");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Manager rejection
  const rejectSubmission = useMutation({
    mutationFn: async (data: { id: string; reason: string }) => {
      if (!user?.id) throw new Error("Not authenticated");
      
      const { data: result, error } = await db
        .from("daily_cogs_submissions")
        .update({
          status: "rejected",
          rejection_reason: data.reason,
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", data.id)
        .select()
        .single();
      
      if (error) throw error;
      return result as COGSSubmission;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cogs-submissions"] });
      queryClient.invalidateQueries({ queryKey: ["cogs-pending-approvals"] });
      toast.success("COGS submission rejected");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Helper to check if remarks are required
  const checkRemarksRequired = (submission: COGSSubmission): { required: boolean; reasons: string[] } => {
    const reasons: string[] = [];
    
    if (submission.food_cost_percentage > FOOD_COST_CRITICAL_THRESHOLD) {
      reasons.push(`Food Cost % (${submission.food_cost_percentage.toFixed(1)}%) exceeds ${FOOD_COST_CRITICAL_THRESHOLD}%`);
    }
    
    if (historicalStats && submission.purchases_value > 0) {
      const avgPurchases = historicalStats.rolling_avg_purchases || historicalStats.avg_purchases || 0;
      if (avgPurchases > 0) {
        const purchaseVariance = ((submission.purchases_value - avgPurchases) / avgPurchases) * 100;
        if (purchaseVariance > PURCHASE_VARIANCE_THRESHOLD) {
          reasons.push(`Purchases (${purchaseVariance.toFixed(0)}% above average)`);
        }
      }
    }
    
    return { required: reasons.length > 0, reasons };
  };

  // Get food cost status
  const getFoodCostStatus = (percentage: number) => {
    if (percentage <= 40) return { status: 'healthy', label: 'Healthy', color: 'text-success' };
    if (percentage <= FOOD_COST_WARNING_THRESHOLD) return { status: 'healthy', label: 'Healthy', color: 'text-success' };
    if (percentage <= FOOD_COST_CRITICAL_THRESHOLD) return { status: 'warning', label: 'Warning', color: 'text-warning' };
    return { status: 'critical', label: 'Critical', color: 'text-destructive' };
  };

  return {
    submissions,
    pendingApprovals,
    historicalStats,
    isLoading: submissionsLoading || pendingLoading,
    createSubmission,
    updateSubmission,
    submitForApproval,
    approveSubmission,
    rejectSubmission,
    checkRemarksRequired,
    getFoodCostStatus,
  };
}

// Hook for managing stock items within a submission
export function useCOGSStockItems(submissionId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: stockItems, isLoading } = useQuery({
    queryKey: ["cogs-stock-items", submissionId],
    queryFn: async () => {
      if (!submissionId) return [];
      
      const { data, error } = await db
        .from("cogs_stock_items")
        .select("*")
        .eq("submission_id", submissionId)
        .order("category");
      
      if (error) throw error;
      return (data || []) as COGSStockItem[];
    },
    enabled: !!submissionId,
  });

  const upsertStockItem = useMutation({
    mutationFn: async (data: {
      submission_id: string;
      stock_type: 'opening' | 'closing';
      category: string;
      amount: number;
      notes?: string;
    }) => {
      const category = STOCK_CATEGORIES.find(c => c.value === data.category);
      
      // Check if item exists
      const { data: existing } = await db
        .from("cogs_stock_items")
        .select("id")
        .eq("submission_id", data.submission_id)
        .eq("stock_type", data.stock_type)
        .eq("category", data.category)
        .single();
      
      if (existing) {
        const { data: result, error } = await db
          .from("cogs_stock_items")
          .update({ amount: data.amount, notes: data.notes })
          .eq("id", existing.id)
          .select()
          .single();
        if (error) throw error;
        return result;
      } else {
        const { data: result, error } = await db
          .from("cogs_stock_items")
          .insert({
            ...data,
            category_label: category?.label || data.category,
          })
          .select()
          .single();
        if (error) throw error;
        return result;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cogs-stock-items", submissionId] });
    },
  });

  // Calculate totals
  const openingTotal = stockItems?.filter(i => i.stock_type === 'opening').reduce((sum, i) => sum + Number(i.amount), 0) || 0;
  const closingTotal = stockItems?.filter(i => i.stock_type === 'closing').reduce((sum, i) => sum + Number(i.amount), 0) || 0;

  return {
    stockItems,
    isLoading,
    upsertStockItem,
    openingTotal,
    closingTotal,
  };
}

// Hook for managing purchases within a submission
export function useCOGSPurchases(submissionId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: purchases, isLoading } = useQuery({
    queryKey: ["cogs-purchases", submissionId],
    queryFn: async () => {
      if (!submissionId) return [];
      
      const { data, error } = await db
        .from("cogs_purchases")
        .select("*")
        .eq("submission_id", submissionId)
        .order("created_at");
      
      if (error) throw error;
      return (data || []) as COGSPurchase[];
    },
    enabled: !!submissionId,
  });

  const addPurchase = useMutation({
    mutationFn: async (data: {
      submission_id: string;
      supplier_name?: string;
      invoice_number?: string;
      payment_mode: 'cash' | 'credit' | 'transfer';
      item_type: string;
      amount: number;
      notes?: string;
    }) => {
      if (!user?.id) throw new Error("Not authenticated");
      
      const { data: result, error } = await db
        .from("cogs_purchases")
        .insert({
          ...data,
          entered_by: user.id,
          missing_bill: !data.invoice_number,
        })
        .select()
        .single();
      
      if (error) throw error;
      return result as COGSPurchase;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cogs-purchases", submissionId] });
      toast.success("Purchase added");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deletePurchase = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db
        .from("cogs_purchases")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cogs-purchases", submissionId] });
      toast.success("Purchase deleted");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Calculate totals
  const purchasesTotal = purchases?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;
  const missingBillsCount = purchases?.filter(p => p.missing_bill).length || 0;

  return {
    purchases,
    isLoading,
    addPurchase,
    deletePurchase,
    purchasesTotal,
    missingBillsCount,
  };
}

// Hook for exception logs
export function useCOGSExceptions(submissionId: string | null) {
  const { data: exceptions, isLoading } = useQuery({
    queryKey: ["cogs-exceptions", submissionId],
    queryFn: async () => {
      if (!submissionId) return [];
      
      const { data, error } = await db
        .from("cogs_exception_logs")
        .select("*")
        .eq("submission_id", submissionId)
        .order("created_at");
      
      if (error) throw error;
      return (data || []) as COGSExceptionLog[];
    },
    enabled: !!submissionId,
  });

  return { exceptions, isLoading };
}
