import { useState } from "react";
import { qk } from "@/lib/query/queryKeys";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, Trash2, User, Pencil, Check, X, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/useCurrency";

interface StaffRate {
  id: string;
  user_id: string;
  hourly_rate: number;
  role_type: string;
  is_active: boolean;
  effective_from: string;
  profile?: { full_name: string | null };
}

const ROLE_TYPES = [
  { value: "cashier", label: "Cashier" },
  { value: "cook", label: "Cook" },
  { value: "server", label: "Server" },
  { value: "manager", label: "Manager" },
  { value: "staff", label: "General Staff" },
];

export function StaffRatesSettings() {
  const { restaurant, user } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ rate: string; role: string }>({ rate: "", role: "" });
  const [isAdding, setIsAdding] = useState(false);
  const [newRate, setNewRate] = useState({ userId: "", rate: "", role: "staff" });

  // Fetch staff rates with profile info
  const { data: staffRates, isLoading } = useQuery({
    queryKey: ["staff-rates", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("staff_rates")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as StaffRate[];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch team members for dropdown
  const { data: teamMembers } = useQuery({
    queryKey: ["team-members-for-rates", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, profiles:user_id(full_name)")
        .eq("restaurant_id", restaurant.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id,
  });

  const createMutation = useMutation({
    mutationFn: async (item: { user_id: string; hourly_rate: number; role_type: string }) => {
      if (!restaurant?.id) throw new Error("No restaurant");
      const { data, error } = await supabase
        .from("staff_rates")
        .insert({
          restaurant_id: restaurant.id,
          user_id: item.user_id,
          hourly_rate: item.hourly_rate,
          role_type: item.role_type,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-rates"] });
      queryClient.invalidateQueries({ queryKey: qk.dailyProfit.entityAll("staff-rates") });
      toast.success("Staff rate added");
      setNewRate({ userId: "", rate: "", role: "staff" });
      setIsAdding(false);
    },
    onError: () => toast.error("Failed to add staff rate"),
  });

  const updateMutation = useMutation({
    mutationFn: async (item: { id: string; hourly_rate: number; role_type: string }) => {
      const { error } = await supabase
        .from("staff_rates")
        .update({
          hourly_rate: item.hourly_rate,
          role_type: item.role_type,
        })
        .eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-rates"] });
      queryClient.invalidateQueries({ queryKey: qk.dailyProfit.entityAll("staff-rates") });
      toast.success("Staff rate updated");
      setEditingId(null);
    },
    onError: () => toast.error("Failed to update rate"),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("staff_rates")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-rates"] });
      queryClient.invalidateQueries({ queryKey: qk.dailyProfit.entityAll("staff-rates") });
    },
    onError: () => toast.error("Failed to toggle rate"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("staff_rates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-rates"] });
      queryClient.invalidateQueries({ queryKey: qk.dailyProfit.entityAll("staff-rates") });
      toast.success("Staff rate removed");
    },
    onError: () => toast.error("Failed to remove rate"),
  });

  const startEditing = (item: StaffRate) => {
    setEditingId(item.id);
    setEditValues({ rate: item.hourly_rate.toString(), role: item.role_type });
  };

  const saveEditing = () => {
    if (!editingId) return;
    const rate = parseFloat(editValues.rate);
    if (isNaN(rate) || rate < 0) {
      toast.error("Please enter a valid rate");
      return;
    }
    updateMutation.mutate({ id: editingId, hourly_rate: rate, role_type: editValues.role });
  };

  const handleAdd = () => {
    const rate = parseFloat(newRate.rate);
    if (!newRate.userId || isNaN(rate) || rate <= 0) {
      toast.error("Please select a team member and enter a valid rate");
      return;
    }
    createMutation.mutate({ user_id: newRate.userId, hourly_rate: rate, role_type: newRate.role });
  };

  const getMemberName = (userId: string) => {
    const member = teamMembers?.find(m => m.user_id === userId);
    return (member?.profiles as any)?.full_name || "Unknown";
  };

  const availableMembers = teamMembers?.filter(
    m => !staffRates?.some(r => r.user_id === m.user_id)
  ) || [];

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-64 mt-1" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Staff Hourly Rates</CardTitle>
        <CardDescription>
          Set hourly rates for accurate labor cost calculation
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        {staffRates && staffRates.length > 0 && (
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
            <div>
              <p className="text-sm text-muted-foreground">Active Staff Rates</p>
              <p className="text-2xl font-semibold">{staffRates.filter(r => r.is_active).length}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Avg. Rate</p>
              <p className="text-lg font-medium text-primary">
                {formatCurrency(
                  staffRates.filter(r => r.is_active).reduce((sum, r) => sum + Number(r.hourly_rate), 0) /
                  (staffRates.filter(r => r.is_active).length || 1)
                )}/hr
              </p>
            </div>
          </div>
        )}

        {/* Staff Rates List */}
        <div className="space-y-2">
          {staffRates?.map((item) => {
            const isEditing = editingId === item.id;

            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-center gap-4 p-3 rounded-lg border transition-colors",
                  item.is_active ? "bg-card" : "bg-muted/30 opacity-60"
                )}
              >
                <div className="p-2 rounded-md bg-accent/50">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>

                {isEditing ? (
                  <>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{getMemberName(item.user_id)}</p>
                    </div>
                    <Select value={editValues.role} onValueChange={(v) => setEditValues(p => ({ ...p, role: v }))}>
                      <SelectTrigger className="w-28 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_TYPES.map((role) => (
                          <SelectItem key={role.value} value={role.value}>
                            {role.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        value={editValues.rate}
                        onChange={(e) => setEditValues(p => ({ ...p, rate: e.target.value }))}
                        className="w-20 h-8"
                      />
                      <span className="text-xs text-muted-foreground">/hr</span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={saveEditing}>
                      <Check className="h-4 w-4 text-success" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingId(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{getMemberName(item.user_id)}</p>
                      <p className="text-xs text-muted-foreground capitalize">{item.role_type}</p>
                    </div>
                    <p className="text-sm font-medium">{formatCurrency(item.hourly_rate)}/hr</p>
                    <Switch
                      checked={item.is_active}
                      onCheckedChange={(checked) => toggleMutation.mutate({ id: item.id, is_active: checked })}
                    />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEditing(item)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => deleteMutation.mutate(item.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Add New */}
        {isAdding ? (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-dashed">
            <Select value={newRate.userId} onValueChange={(v) => setNewRate(p => ({ ...p, userId: v }))}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select team member" />
              </SelectTrigger>
              <SelectContent>
                {availableMembers.map((member) => (
                  <SelectItem key={member.user_id} value={member.user_id}>
                    {(member.profiles as any)?.full_name || "Unknown"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={newRate.role} onValueChange={(v) => setNewRate(p => ({ ...p, role: v }))}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_TYPES.map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                placeholder="Rate"
                value={newRate.rate}
                onChange={(e) => setNewRate(p => ({ ...p, rate: e.target.value }))}
                className="w-24"
              />
              <span className="text-xs text-muted-foreground">/hr</span>
            </div>
            <Button size="sm" onClick={handleAdd} disabled={createMutation.isPending}>
              Add
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setIsAdding(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setIsAdding(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Staff Rate
          </Button>
        )}

        {availableMembers.length === 0 && !isAdding && staffRates && staffRates.length > 0 && (
          <p className="text-xs text-muted-foreground text-center">
            All team members have hourly rates configured
          </p>
        )}
      </CardContent>
    </Card>
  );
}
