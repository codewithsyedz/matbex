import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StaffTableCardSkeleton } from "@/components/staff/StaffSkeletons";
import { Plus, MoreHorizontal, User, Phone, Loader2, Edit, Trash2, PlusCircle, Users, List, AlertCircle, Link2, ArrowRightLeft } from "lucide-react";
import { StaffTransferDialog } from "./StaffTransferDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link as RouterLink } from "react-router-dom";
import { useCurrency } from "@/hooks/useCurrency";
import { Switch } from "@/components/ui/switch";
import { useBranch } from "@/contexts/BranchContext";
import { BranchBadge } from "@/components/branch/BranchBadge";
import { useTranslation } from "react-i18next";

type PaymentType = "hourly" | "monthly";

interface Staff {
  id: string;
  name: string;
  phone: string | null;
  role: string;
  hourly_rate: number;
  monthly_salary: number | null;
  payment_type: PaymentType;
  is_active: boolean;
  joined_date: string;
  notes: string | null;
  restaurant_id: string;
  assigned_branch_id: string | null;
  user_id: string | null;
}

interface StaffType {
  id: string;
  name: string;
  restaurant_id: string;
}

const DEFAULT_STAFF_TYPES = ["Cook", "Tandoor (Roti Maker)", "Waiter", "Cleaner", "Cashier"];

export function StaffManager() {
  const { restaurant, hasRole, tenant, user } = useAuth() as any;
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const isManager = hasRole("owner") || hasRole("manager");
  const { branches, hasMultipleBranches, activeBranchId, isAllBranches, activeBranch } = useBranch();
  const { t, i18n } = useTranslation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [staffToDelete, setStaffToDelete] = useState<Staff | null>(null);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [staffToTransfer, setStaffToTransfer] = useState<Staff | null>(null);
  const [newTypeName, setNewTypeName] = useState("");
  const [groupByRole, setGroupByRole] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");

  // Inline "invite cashier" state used by the guided empty-state when no
  // Cashier team users exist yet. Lets owners/managers send the invite
  // without leaving the Add Staff dialog.
  const [inlineInviteEmail, setInlineInviteEmail] = useState("");
  const [isInlineInviting, setIsInlineInviting] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    role: "",
    payment_type: "monthly" as PaymentType,
    hourly_rate: "",
    monthly_salary: "",
    joined_date: new Date().toISOString().split("T")[0],
    notes: "",
    assigned_branch_id: "" as string,
    user_id: "" as string,
  });

  // Fetch custom staff types
  const { data: customStaffTypes } = useQuery({
    queryKey: ["staff-types", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("staff_types")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("name");

      if (error) throw error;
      return data as StaffType[];
    },
    enabled: !!restaurant?.id,
  });

  // Combine default and custom types
  const allStaffTypes = [
    ...DEFAULT_STAFF_TYPES,
    ...(customStaffTypes?.map((t) => t.name) || []),
  ].filter((value, index, self) => self.indexOf(value) === index); // Remove duplicates

  // Fetch users with Cashier team role (for linking to staff records)
  const { data: cashierUsers } = useQuery({
    queryKey: ["cashier-team-users", restaurant?.tenant_id],
    queryFn: async () => {
      if (!restaurant?.tenant_id) return [];
      const { data: roles, error } = await supabase
        .from("user_tenant_roles")
        .select("user_id")
        .eq("tenant_id", restaurant.tenant_id)
        .eq("role", "cashier");
      if (error) throw error;
      const ids = (roles ?? []).map((r) => r.user_id);
      if (ids.length === 0) return [] as { id: string; full_name: string | null }[];
      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      if (pErr) throw pErr;
      return profiles ?? [];
    },
    enabled: !!restaurant?.tenant_id,
  });

  const { data: staffList, isLoading } = useQuery({
    queryKey: ["staff-full", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("staff")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("name");

      if (error) throw error;
      return data as Staff[];
    },
    enabled: !!restaurant?.id,
  });

  const invalidateStaffQueries = () => {
    if (!restaurant?.id) return;
    queryClient.invalidateQueries({ queryKey: ["staff-full", restaurant.id] });
    queryClient.invalidateQueries({ queryKey: ["staff-active", restaurant.id] });
    queryClient.invalidateQueries({ queryKey: ["staff-summary", restaurant.id] });
  };

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!restaurant?.id) throw new Error("No restaurant");
      const { error } = await supabase.from("staff").insert({
        restaurant_id: restaurant.id,
        name: data.name,
        phone: data.phone || null,
        role: data.role,
        payment_type: data.payment_type,
        hourly_rate: data.payment_type === "hourly" ? parseFloat(data.hourly_rate) || 0 : 0,
        monthly_salary: data.payment_type === "monthly" ? parseFloat(data.monthly_salary) || null : null,
        joined_date: data.joined_date,
        notes: data.notes || null,
        assigned_branch_id: data.assigned_branch_id || null,
        user_id: data.user_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateStaffQueries();
      toast.success("Staff member added");
      resetForm();
      setDialogOpen(false);
    },
    onError: (error) => {
      toast.error("Failed to add staff member");
      console.error(error);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData & { id: string }) => {
      const { error } = await supabase
        .from("staff")
        .update({
          name: data.name,
          phone: data.phone || null,
          role: data.role,
          payment_type: data.payment_type,
          hourly_rate: data.payment_type === "hourly" ? parseFloat(data.hourly_rate) || 0 : 0,
          monthly_salary: data.payment_type === "monthly" ? parseFloat(data.monthly_salary) || null : null,
          joined_date: data.joined_date,
          notes: data.notes || null,
          assigned_branch_id: data.assigned_branch_id || null,
          user_id: data.user_id || null,
        })
        .eq("id", data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateStaffQueries();
      toast.success("Staff member updated");
      resetForm();
      setDialogOpen(false);
      setEditingStaff(null);
    },
    onError: (error) => {
      toast.error("Failed to update staff member");
      console.error(error);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateStaffQueries();
      toast.success("Staff member deleted");
      setDeleteDialogOpen(false);
      setStaffToDelete(null);
    },
    onError: (error) => {
      toast.error("Failed to delete staff member");
      console.error(error);
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      // When deactivating staff, set termination_date for versioned overhead calculation
      // When reactivating, clear termination_date
      const updateData: { is_active: boolean; termination_date?: string | null } = { is_active };
      
      if (!is_active) {
        // Staff is being deactivated - set termination date to today
        updateData.termination_date = new Date().toISOString().split("T")[0];
      } else {
        // Staff is being reactivated - clear termination date
        updateData.termination_date = null;
      }
      
      const { error } = await supabase.from("staff").update(updateData).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateStaffQueries();
      toast.success("Staff status updated");
    },
    onError: (error) => {
      toast.error("Failed to update status");
      console.error(error);
    },
  });

  const addStaffTypeMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!restaurant?.id) throw new Error("No restaurant");
      const { error } = await supabase.from("staff_types").insert({
        restaurant_id: restaurant.id,
        name: name.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-types"] });
      toast.success("Staff type added");
      setNewTypeName("");
      setTypeDialogOpen(false);
    },
    onError: (error: any) => {
      if (error.code === "23505") {
        toast.error("This staff type already exists");
      } else {
        toast.error("Failed to add staff type");
      }
      console.error(error);
    },
  });

  const deleteStaffTypeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff_types").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-types"] });
      toast.success("Staff type deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete staff type");
      console.error(error);
    },
  });

  // Guided empty-state invite: when no Cashier team users exist yet, owners
  // and managers can send an invite right from the Add Staff dialog instead
  // of being told to leave for the Team page.
  const handleInlineCashierInvite = async () => {
    if (!restaurant?.id || !user?.id) return;
    const email = inlineInviteEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Enter a valid email address");
      return;
    }
    setIsInlineInviting(true);
    try {
      const { error } = await supabase.functions.invoke("send-invite", {
        body: {
          email,
          role: "cashier",
          restaurant_id: restaurant.id,
          restaurant_name: restaurant.name,
          tenant_id: tenant?.id,
          invited_by: user.email || "Team Owner",
          invited_by_user_id: user.id,
        },
      });
      if (error) throw error;
      toast.success(`Cashier invite sent to ${email}`);
      setInlineInviteEmail("");
      // The user account will appear once they accept the invite and the
      // cashier role is created. Refetch so the dropdown picks it up.
      queryClient.invalidateQueries({
        queryKey: ["cashier-team-users", restaurant?.tenant_id],
      });
    } catch (err: any) {
      console.error("Inline cashier invite failed", err);
      toast.error(err?.message || "Failed to send cashier invite");
    } finally {
      setIsInlineInviting(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      phone: "",
      role: allStaffTypes[0] || "",
      payment_type: "monthly",
      hourly_rate: "",
      monthly_salary: "",
      joined_date: new Date().toISOString().split("T")[0],
      notes: "",
      assigned_branch_id: "",
      user_id: "",
    });
  };

  const handleEdit = (staff: Staff) => {
    setEditingStaff(staff);
    setFormData({
      name: staff.name,
      phone: staff.phone || "",
      role: staff.role,
      payment_type: staff.payment_type as PaymentType,
      hourly_rate: staff.hourly_rate?.toString() || "",
      monthly_salary: staff.monthly_salary?.toString() || "",
      joined_date: staff.joined_date,
      notes: staff.notes || "",
      assigned_branch_id: staff.assigned_branch_id || "",
      user_id: staff.user_id || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast.error("Please enter staff name");
      return;
    }
    if (!formData.role) {
      toast.error("Please select a role");
      return;
    }
    if (editingStaff) {
      updateMutation.mutate({ ...formData, id: editingStaff.id });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleOpenDialog = () => {
    resetForm();
    setEditingStaff(null);
    setDialogOpen(true);
  };

  const handleAddType = () => {
    if (!newTypeName.trim()) {
      toast.error("Please enter a type name");
      return;
    }
    addStaffTypeMutation.mutate(newTypeName);
  };

  if (isLoading) {
    return <StaffTableCardSkeleton rows={6} />;
  }

  // Apply branch scope: include staff pinned to the active branch and
  // "shared" staff with no pin. Managers viewing "All" see everyone.
  const scopedStaffList = (staffList || []).filter((s) => {
    if (isAllBranches || !activeBranchId) return true;
    return !s.assigned_branch_id || s.assigned_branch_id === activeBranchId;
  });
  const activeStaff = scopedStaffList.filter((s) => s.is_active);
  const inactiveCount = scopedStaffList.length - activeStaff.length;

  // Status filter (active / inactive / all)
  const visibleStaffList = scopedStaffList.filter((s) =>
    statusFilter === "all" ? true : statusFilter === "active" ? s.is_active : !s.is_active,
  );

  // Roles are free text, so "Cook" and "cook" must land in the same group.
  const roleKey = (role?: string | null) => (role || "Unknown").trim().toLowerCase();
  const roleLabel = (role?: string | null) => {
    const v = (role || "Unknown").trim();
    const knownRoles: Record<string, string> = {
      cook: t("app.staff.roles.cook"),
      "tandoor (roti maker)": t("app.staff.roles.tandoor"),
      waiter: t("app.staff.roles.waiter"),
      cleaner: t("app.staff.roles.cleaner"),
      cashier: t("app.staff.roles.cashier"),
      unknown: t("app.staff.roles.unknown"),
    };
    if (knownRoles[v.toLowerCase()]) return knownRoles[v.toLowerCase()];
    return v.charAt(0).toUpperCase() + v.slice(1);
  };

  // Calculate role-wise salary breakdown
  const roleSalaryBreakdown = scopedStaffList.reduce((acc, staff) => {
    const role = roleKey(staff.role);
    if (!acc[role]) {
      acc[role] = { count: 0, totalSalary: 0, activeCount: 0, label: roleLabel(staff.role) };
    }
    acc[role].count += 1;
    if (staff.is_active) {
      acc[role].activeCount += 1;
      acc[role].totalSalary += staff.payment_type === "monthly" 
        ? (staff.monthly_salary || 0) 
        : (staff.hourly_rate * 160); // Assume 160 hours/month for hourly
    }
    return acc;
  }, {} as Record<string, { count: number; totalSalary: number; activeCount: number; label: string }>);

  // Group staff by role
  const groupedStaff = visibleStaffList.reduce((acc, staff) => {
    const role = roleKey(staff.role);
    if (!acc[role]) {
      acc[role] = { label: roleLabel(staff.role), members: [] };
    }
    acc[role].members.push(staff);
    return acc;
  }, {} as Record<string, { label: string; members: Staff[] }>);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-medium">{t("app.staff.members.title")}</CardTitle>
            <CardDescription>
              {t("app.staff.members.description", { count: activeStaff.length })}
            </CardDescription>
          </div>
          {isManager && (
            <div className="flex gap-2">
              <Dialog open={typeDialogOpen} onOpenChange={setTypeDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <PlusCircle className="h-4 w-4 me-2" />
                    {t("app.staff.members.addRole")}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>{t("app.staff.members.addRole")}</DialogTitle>
                    <DialogDescription>{t("app.staff.members.addRoleDescription")}</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="typeName">{t("app.staff.members.roleName")}</Label>
                      <Input
                        id="typeName"
                        placeholder={t("app.staff.members.rolePlaceholder")}
                        value={newTypeName}
                        onChange={(e) => setNewTypeName(e.target.value)}
                      />
                    </div>
                    {customStaffTypes && customStaffTypes.length > 0 && (
                      <div className="space-y-2">
                        <Label>{t("app.staff.members.customRoles")}</Label>
                        <div className="flex flex-wrap gap-2">
                          {customStaffTypes.map((type) => (
                            <Badge
                              key={type.id}
                              variant="secondary"
                              className="gap-1 cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                              onClick={() => deleteStaffTypeMutation.mutate(type.id)}
                            >
                              {type.name}
                              <Trash2 className="h-3 w-3" />
                            </Badge>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground">{t("app.staff.members.clickToDelete")}</p>
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setTypeDialogOpen(false)}>
                      {t("common.cancel")}
                    </Button>
                    <Button onClick={handleAddType} disabled={addStaffTypeMutation.isPending}>
                      {addStaffTypeMutation.isPending && (
                        <Loader2 className="h-4 w-4 me-2 animate-spin" />
                      )}
                      {t("app.staff.members.addRole")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button onClick={handleOpenDialog}>
                    <Plus className="h-4 w-4 me-2" />
                    {t("app.staff.members.addStaff")}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>{editingStaff ? t("app.staff.members.editStaff") : t("app.staff.members.addStaffMember")}</DialogTitle>
                    <DialogDescription>
                      {editingStaff ? t("app.staff.members.updateDescription") : t("app.staff.members.addDescription")}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">{t("app.staff.fields.name")} *</Label>
                      <Input
                        id="name"
                        placeholder={t("app.staff.fields.namePlaceholder")}
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">{t("app.staff.fields.phone")}</Label>
                      <Input
                        id="phone"
                        placeholder={t("app.staff.fields.phonePlaceholder")}
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("app.staff.fields.role")} *</Label>
                      <Select
                        value={formData.role}
                        onValueChange={(v) => setFormData({ ...formData, role: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("app.staff.fields.selectRole")} />
                        </SelectTrigger>
                        <SelectContent>
                          {allStaffTypes.map((role) => (
                            <SelectItem key={role} value={role}>
                              {roleLabel(role)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {formData.role?.toLowerCase() === "cashier" && (
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                          <Link2 className="h-4 w-4" />
                          Linked User Account
                          <span className="text-xs text-amber-600">Required for branch hard-lock</span>
                        </Label>
                        {cashierUsers && cashierUsers.length > 0 ? (
                          <>
                            <Select
                              value={formData.user_id || "__none__"}
                              onValueChange={(v) =>
                                setFormData({ ...formData, user_id: v === "__none__" ? "" : v })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select cashier user account" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Not linked yet</SelectItem>
                                {cashierUsers.map((u) => (
                                  <SelectItem key={u.id} value={u.id}>
                                    {u.full_name || u.id.slice(0, 8)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                              Linking this staff record to a user account is what activates the
                              branch hard-lock when that user signs in.
                            </p>
                          </>
                        ) : (
                          <div
                            data-testid="cashier-empty-state"
                            className="rounded-md border border-warning/35 bg-warning/10 p-4 text-foreground space-y-3"
                          >
                            <div className="flex items-start gap-2">
                              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                              <div className="space-y-1">
                                <p className="font-medium text-sm">
                                  No Cashier team users yet
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Send a Cashier invite right here — once accepted, the
                                  user appears in the dropdown above and the branch
                                  hard-lock activates on their next sign-in.
                                </p>
                              </div>
                            </div>
                            {isManager ? (
                              <div className="flex flex-col sm:flex-row gap-2">
                                <Input
                                  type="email"
                                  placeholder="cashier@example.com"
                                  value={inlineInviteEmail}
                                  onChange={(e) => setInlineInviteEmail(e.target.value)}
                                  className="bg-card"
                                  disabled={isInlineInviting}
                                  data-testid="cashier-invite-email"
                                />
                                <Button
                                  type="button"
                                  onClick={handleInlineCashierInvite}
                                  disabled={isInlineInviting || !inlineInviteEmail.trim()}
                                  data-testid="cashier-invite-send"
                                >
                                  {isInlineInviting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <>
                                      <PlusCircle className="h-4 w-4 mr-1" />
                                      Send Cashier invite
                                    </>
                                  )}
                                </Button>
                              </div>
                            ) : (
                              <p className="text-xs">
                                Only owners or managers can send team invites. Ask an
                                owner to invite a Cashier from the Team page.
                              </p>
                            )}
                            <p className="text-xs">
                              Prefer the full flow?{" "}
                              <RouterLink
                                to="/team"
                                className="inline-flex items-center gap-1 font-medium underline"
                              >
                                Open Team → Members
                              </RouterLink>
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>{t("app.staff.fields.paymentType")} *</Label>
                      <Select
                        value={formData.payment_type}
                        onValueChange={(v) => setFormData({ ...formData, payment_type: v as PaymentType })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hourly">{t("app.staff.fields.hourly")}</SelectItem>
                          <SelectItem value="monthly">{t("app.staff.fields.monthly")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {formData.payment_type === "hourly" ? (
                      <div className="space-y-2">
                        <Label htmlFor="hourly_rate">{t("staff.hourlyRate")}</Label>
                        <Input
                          id="hourly_rate"
                          type="number"
                          placeholder="0.00"
                          value={formData.hourly_rate}
                          onChange={(e) => setFormData({ ...formData, hourly_rate: e.target.value })}
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="monthly_salary">{t("staff.monthlySalary")}</Label>
                        <Input
                          id="monthly_salary"
                          type="number"
                          placeholder="0.00"
                          value={formData.monthly_salary}
                          onChange={(e) => setFormData({ ...formData, monthly_salary: e.target.value })}
                        />
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="joined_date">{t("app.staff.fields.joinedDate")}</Label>
                      <Input
                        id="joined_date"
                        type="date"
                        value={formData.joined_date}
                        onChange={(e) => setFormData({ ...formData, joined_date: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="notes">{t("app.staff.fields.notes")}</Label>
                      <Input
                        id="notes"
                        placeholder={t("app.staff.fields.notesPlaceholder")}
                        value={formData.notes}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      />
                    </div>
                    {hasMultipleBranches && (
                      <div className="space-y-2">
                        <Label>
                          Branch Access
                          {formData.role?.toLowerCase() === "cashier" && (
                            <span className="ml-2 text-xs text-amber-600">
                              Recommended for cashiers
                            </span>
                          )}
                        </Label>
                        <Select
                          value={formData.assigned_branch_id || "__all__"}
                          onValueChange={(v) =>
                            setFormData({ ...formData, assigned_branch_id: v === "__all__" ? "" : v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">All branches (unrestricted)</SelectItem>
                            {branches.map((b) => (
                              <SelectItem key={b.id} value={b.id}>
                                {b.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          When pinned to a branch, this user can only view and record data for that branch.
                          Cashiers should typically be pinned to the branch they work at.
                        </p>
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDialogOpen(false)}>
                      {t("common.cancel")}
                    </Button>
                    <Button
                      onClick={handleSubmit}
                      disabled={createMutation.isPending || updateMutation.isPending}
                    >
                      {(createMutation.isPending || updateMutation.isPending) && (
                        <Loader2 className="h-4 w-4 me-2 animate-spin" />
                      )}
                      {editingStaff ? t("common.update") : t("app.staff.members.addStaff")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Role-wise Salary Breakdown */}
          {Object.keys(roleSalaryBreakdown).length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(roleSalaryBreakdown).map(([role, data]) => (
                <div
                  key={role}
                  className="p-3 rounded-lg bg-muted/50 border"
                >
                  <p className="text-xs text-muted-foreground capitalize">{data.label}</p>
                  <p className="text-lg font-semibold text-foreground">{formatCurrency(data.totalSalary)}</p>
                  <p className="text-xs text-muted-foreground">{t("app.staff.members.activeCount", { count: data.activeCount })}</p>
                </div>
              ))}
            </div>
          )}

          {/* Group by toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {groupByRole ? <Users className="h-4 w-4" /> : <List className="h-4 w-4" />}
              <span>{t("app.staff.members.groupByRole")}</span>
              <Switch className="ms-2" checked={groupByRole} onCheckedChange={setGroupByRole} />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="h-8 w-[170px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t("app.staff.members.activeFilter", { count: activeStaff.length })}</SelectItem>
                <SelectItem value="inactive">{t("app.staff.members.inactiveFilter", { count: inactiveCount })}</SelectItem>
                <SelectItem value="all">{t("app.staff.members.allFilter", { count: scopedStaffList.length })}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {visibleStaffList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <User className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">
                {scopedStaffList.length === 0 ? "No staff members yet" : `No ${statusFilter} staff`}
              </p>
              <p className="text-sm text-muted-foreground">
                {scopedStaffList.length === 0
                  ? "Add your first staff member to get started"
                  : "Try a different status filter"}
              </p>
            </div>
          ) : groupByRole ? (
            /* Grouped View */
            <div className="space-y-6">
              {Object.entries(groupedStaff).map(([role, { label, members }]) => (
                <div key={role} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium capitalize text-foreground flex items-center gap-2">
                      <Badge variant="outline">{label}</Badge>
                      <span className="text-xs text-muted-foreground">
                        ({members.filter(m => m.is_active).length} active)
                      </span>
                    </h3>
                    <span className="text-sm font-medium text-foreground">
                      {formatCurrency(
                        members
                          .filter(m => m.is_active)
                          .reduce((sum, m) => sum + (m.payment_type === "monthly" ? (m.monthly_salary || 0) : m.hourly_rate * 160), 0)
                      )}/mo
                    </span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[180px]">{t("app.staff.fields.name")}</TableHead>
                        <TableHead className="min-w-[100px]">{t("app.staff.fields.payment")}</TableHead>
                        <TableHead className="min-w-[80px]">{t("app.staff.fields.status")}</TableHead>
                        <TableHead className="min-w-[100px]">{t("app.staff.fields.joined")}</TableHead>
                        {isManager && <TableHead className="w-10"></TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((staff) => (
                        <TableRow key={staff.id} className={!staff.is_active ? "opacity-50" : ""}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                <User className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-foreground truncate">{staff.name || "No name"}</p>
                                {staff.phone && (
                                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Phone className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate">{staff.phone}</span>
                                  </p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-foreground">
                            {staff.payment_type === "hourly"
                              ? `${formatCurrency(staff.hourly_rate)}/hr`
                              : formatCurrency(staff.monthly_salary || 0) + "/mo"}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <Badge variant={staff.is_active ? "default" : "secondary"}>
                                {staff.is_active ? t("common.active") : t("common.inactive")}
                              </Badge>
                              {staff.role?.toLowerCase() === "cashier" && (
                                <>
                                  {!staff.user_id && !staff.assigned_branch_id ? (
                                    <Badge variant="destructive">Setup Required</Badge>
                                  ) : !staff.user_id ? (
                                    <Badge variant="secondary">No User</Badge>
                                  ) : !staff.assigned_branch_id ? (
                                    <Badge variant="secondary">No Branch</Badge>
                                  ) : (
                                    <Badge variant="default">Ready</Badge>
                                  )}
                                </>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-foreground">
                            {staff.joined_date ? new Date(staff.joined_date + 'T00:00:00').toLocaleDateString(i18n.language === "ar" ? "ar-SA" : "en-US") : "-"}
                          </TableCell>
                          {isManager && (
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleEdit(staff)}>
                                    <Edit className="h-4 w-4 mr-2" />
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      toggleActiveMutation.mutate({
                                        id: staff.id,
                                        is_active: !staff.is_active,
                                      })
                                    }
                                  >
                                    {staff.is_active ? "Deactivate" : "Activate"}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => {
                                      setStaffToDelete(staff);
                                      setDeleteDialogOpen(true);
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          ) : (
            /* List View */
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[180px]">{t("app.staff.fields.name")}</TableHead>
                  <TableHead className="min-w-[100px]">{t("app.staff.fields.role")}</TableHead>
                  <TableHead className="min-w-[100px]">{t("app.staff.fields.payment")}</TableHead>
                  {hasMultipleBranches && (
                    <TableHead className="min-w-[120px]">{t("app.staff.fields.branch")}</TableHead>
                  )}
                  <TableHead className="min-w-[80px]">{t("app.staff.fields.status")}</TableHead>
                  <TableHead className="min-w-[100px]">{t("app.staff.fields.joined")}</TableHead>
                  {isManager && <TableHead className="w-10"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleStaffList.map((staff) => (
                  <TableRow key={staff.id} className={!staff.is_active ? "opacity-50" : ""}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          <User className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{staff.name || "No name"}</p>
                          {staff.phone && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Phone className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate">{staff.phone}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{roleLabel(staff.role)}</Badge>
                    </TableCell>
                    <TableCell className="text-foreground">
                      {staff.payment_type === "hourly"
                        ? `${formatCurrency(staff.hourly_rate)}/hr`
                        : formatCurrency(staff.monthly_salary || 0) + "/mo"}
                    </TableCell>
                    {hasMultipleBranches && (
                      <TableCell>
                        {staff.assigned_branch_id ? (
                          <BranchBadge
                            size="sm"
                            branchId={staff.assigned_branch_id}
                            name={branches.find((b) => b.id === staff.assigned_branch_id)?.name ?? null}
                            untaggedLabel="Unknown branch"
                          />
                        ) : (
                          <Badge
                            variant="outline"
                            className="rounded-full font-normal text-[10px] px-1.5 py-0 text-muted-foreground"
                          >
                            All branches
                          </Badge>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={staff.is_active ? "default" : "secondary"}>
                          {staff.is_active ? t("common.active") : t("common.inactive")}
                        </Badge>
                        {staff.role?.toLowerCase() === "cashier" && (
                          <>
                            {!staff.user_id && !staff.assigned_branch_id ? (
                              <Badge variant="destructive">Setup Required</Badge>
                            ) : !staff.user_id ? (
                              <Badge variant="secondary">No User</Badge>
                            ) : !staff.assigned_branch_id ? (
                              <Badge variant="secondary">No Branch</Badge>
                            ) : (
                              <Badge variant="default">Ready</Badge>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-foreground">
                      {staff.joined_date ? new Date(staff.joined_date + 'T00:00:00').toLocaleDateString(i18n.language === "ar" ? "ar-SA" : "en-US") : "-"}
                    </TableCell>
                    {isManager && (
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(staff)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            {branches.filter((b) => b.is_active).length > 1 && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setStaffToTransfer(staff);
                                  setTransferDialogOpen(true);
                                }}
                              >
                                <ArrowRightLeft className="h-4 w-4 mr-2" />
                                Transfer to branch…
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() =>
                                toggleActiveMutation.mutate({
                                  id: staff.id,
                                  is_active: !staff.is_active,
                                })
                              }
                            >
                              {staff.is_active ? "Deactivate" : "Activate"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                setStaffToDelete(staff);
                                setDeleteDialogOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("app.staff.members.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("app.staff.members.deleteDescription", { name: staffToDelete?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => staffToDelete && deleteMutation.mutate(staffToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <StaffTransferDialog
        open={transferDialogOpen}
        onOpenChange={(v) => {
          setTransferDialogOpen(v);
          if (!v) setStaffToTransfer(null);
        }}
        staff={
          staffToTransfer
            ? {
                id: staffToTransfer.id,
                name: staffToTransfer.name,
                assigned_branch_id: staffToTransfer.assigned_branch_id,
              }
            : null
        }
      />
    </>
  );
}
