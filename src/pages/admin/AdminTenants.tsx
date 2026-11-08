import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CreateTenantDialog } from "@/components/admin/CreateTenantDialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { db } from "@/integrations/db/client";
import { useSuperAdmin } from "@/contexts/SuperAdminContext";
import { useSuperAdminAudit } from "@/hooks/useSuperAdminAudit";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { MoreHorizontal, Search, Building2, Power, PowerOff, Settings2, Store, Eye, Clock, FileText, Pencil, AlertCircle, CheckCircle2, Plus } from "lucide-react";
import { format, differenceInDays } from "date-fns";

interface Plan {
  id: string;
  name: string;
  price: number;
  default_feature_flags: Record<string, boolean>;
}

interface Restaurant {
  id: string;
  name: string;
  status: string;
}

interface TenantFeature {
  id: string;
  feature_key: string;
  enabled: boolean;
}

interface Tenant {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  plan_id: string | null;
  created_at: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  trial_ends_at: string | null;
  user_count?: number;
  restaurant_count?: number;
  plan?: Plan | null;
  restaurants?: Restaurant[];
  features?: TenantFeature[];
}

const FEATURE_FLAGS = [
  { key: "daily_profit", label: "Daily Profit", description: "Daily profit calculations and reports" },
  { key: "accounting", label: "Accounting Module", description: "Chart of accounts, journal entries, and period close" },
  { key: "inventory", label: "Inventory Module", description: "Stock tracking and purchase management" },
  { key: "payroll", label: "Payroll Module", description: "Labor cost tracking and payroll management" },
  { key: "chat", label: "Team Chat", description: "Real-time team messaging and channels" },
  { key: "cogs", label: "COGS Tracking", description: "Cost of goods sold analysis and reporting" },
  { key: "menu", label: "Menu Management", description: "Menu items, recipes, and pricing" },
  { key: "advance_pay", label: "Advance Pay", description: "Employee advance payment feature" },
  { key: "api_access", label: "API Access", description: "REST API access for integrations" },
  { key: "multi_location", label: "Multi-Location", description: "Multiple restaurant locations" },
  { key: "email_reports", label: "Email Reports", description: "Automated email report delivery" },
  { key: "advanced_reports", label: "Advanced Reports", description: "Advanced analytics and reporting" },
];

export default function AdminTenants() {
  const navigate = useNavigate();
  const { startImpersonation } = useSuperAdmin();
  const { logTenantRename } = useSuperAdminAudit();
  const { tenant: activeTenant, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [editedSlug, setEditedSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [renameErrors, setRenameErrors] = useState<string[]>([]);
  const [slugChecking, setSlugChecking] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [editedFeatures, setEditedFeatures] = useState<Record<string, boolean>>({});
  const [editedPlanId, setEditedPlanId] = useState<string | null>(null);

  // Create-branch dialog state
  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [branchTenantId, setBranchTenantId] = useState<string>("");
  const [branchRestaurantId, setBranchRestaurantId] = useState<string>("");
  const [branchForm, setBranchForm] = useState({
    name: "",
    code: "",
    address: "",
    phone: "",
  });

  // Handle plan change and load its default features
  const handlePlanChange = (planId: string) => {
    setEditedPlanId(planId);
    
    // Find the selected plan and load its default features
    const selectedPlan = plans.find(p => p.id === planId);
    if (selectedPlan) {
      const planFlags = selectedPlan.default_feature_flags || {};
      // Merge plan defaults with any existing tenant overrides
      const tenantOverrides: Record<string, boolean> = {};
      selectedTenant?.features?.forEach((f) => {
        tenantOverrides[f.feature_key] = f.enabled;
      });
      
      // Start with plan defaults, then apply tenant overrides only for features that exist
      const newFeatures: Record<string, boolean> = { ...planFlags };
      // Apply tenant overrides only if switching back to the original plan
      if (planId === selectedTenant?.plan_id) {
        Object.entries(tenantOverrides).forEach(([key, enabled]) => {
          newFeatures[key] = enabled;
        });
      }
      setEditedFeatures(newFeatures);
    }
  };

  const fetchPlans = async () => {
    const { data } = await db
      .from("plans")
      .select("*")
      .eq("is_active", true)
      .order("price", { ascending: true });
    
    setPlans((data || []).map(p => ({
      ...p,
      default_feature_flags: (p.default_feature_flags && typeof p.default_feature_flags === 'object' && !Array.isArray(p.default_feature_flags))
        ? p.default_feature_flags as Record<string, boolean>
        : {}
    })));
  };

  const fetchTenants = async () => {
    try {
      const { data: tenantsData, error } = await db
        .from("tenants")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Fetch additional data for each tenant
      const tenantsWithDetails = await Promise.all(
        (tenantsData || []).map(async (tenant) => {
          // User count
          const { count: userCount } = await db
            .from("user_tenant_roles")
            .select("*", { count: "exact", head: true })
            .eq("tenant_id", tenant.id);

          // Restaurant count and list
          const { data: restaurants } = await db
            .from("restaurants")
            .select("id, name, status")
            .eq("tenant_id", tenant.id);

          // Plan details
          let planData = null;
          if (tenant.plan_id) {
            const { data } = await db
              .from("plans")
              .select("*")
              .eq("id", tenant.plan_id)
              .maybeSingle();
            planData = data ? {
              ...data,
              default_feature_flags: (data.default_feature_flags && typeof data.default_feature_flags === 'object' && !Array.isArray(data.default_feature_flags))
                ? data.default_feature_flags as Record<string, boolean>
                : {}
            } : null;
          }

          // Tenant features
          const { data: features } = await db
            .from("tenant_features")
            .select("*")
            .eq("tenant_id", tenant.id);

          return {
            ...tenant,
            user_count: userCount || 0,
            restaurant_count: restaurants?.length || 0,
            restaurants: restaurants || [],
            plan: planData,
            features: features || [],
          };
        })
      );

      setTenants(tenantsWithDetails);
    } catch (error) {
      console.error("Error fetching tenants:", error);
      toast.error("Failed to load tenants");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlans();
    fetchTenants();
  }, []);

  const handleSuspend = async () => {
    if (!selectedTenant) return;
    setActionLoading(true);

    try {
      const { error } = await db
        .from("tenants")
        .update({
          status: "suspended",
          suspended_at: new Date().toISOString(),
          suspended_reason: suspendReason || null,
        })
        .eq("id", selectedTenant.id);

      if (error) throw error;

      toast.success(`${selectedTenant.name} has been suspended`);
      setSuspendDialogOpen(false);
      setSuspendReason("");
      setSelectedTenant(null);
      fetchTenants();
    } catch (error) {
      console.error("Error suspending tenant:", error);
      toast.error("Failed to suspend tenant");
    } finally {
      setActionLoading(false);
    }
  };

  const handleActivate = async (tenant: Tenant) => {
    setActionLoading(true);

    try {
      const { error } = await db
        .from("tenants")
        .update({
          status: "active",
          suspended_at: null,
          suspended_reason: null,
        })
        .eq("id", tenant.id);

      if (error) throw error;

      toast.success(`${tenant.name} has been activated`);
      fetchTenants();
    } catch (error) {
      console.error("Error activating tenant:", error);
      toast.error("Failed to activate tenant");
    } finally {
      setActionLoading(false);
    }
  };

  const generateSlug = (input: string) =>
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const openSuspendDialog = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setSuspendDialogOpen(true);
  };

  const openRenameDialog = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setEditedName(tenant.name);
    setEditedSlug(tenant.slug || "");
    setSlugTouched(false);
    setRenameErrors([]);
    setSlugChecking(false);
    setRenameDialogOpen(true);
  };

  // Auto-generate slug from name when the slug field hasn't been manually edited
  useEffect(() => {
    if (!slugTouched) {
      setEditedSlug(generateSlug(editedName));
    }
  }, [editedName, slugTouched]);

  const validateRename = async (): Promise<boolean> => {
    const errors: string[] = [];
    const trimmedName = editedName.trim();
    const trimmedSlug = editedSlug.trim();
    const finalSlug = trimmedSlug || generateSlug(trimmedName);

    if (!trimmedName) {
      errors.push("Tenant name is required.");
    } else if (trimmedName.length < 2) {
      errors.push("Tenant name must be at least 2 characters.");
    }

    if (finalSlug && !/^[a-z0-9-]+$/.test(finalSlug)) {
      errors.push("Slug can only contain lowercase letters, numbers, and hyphens.");
    }
    if (finalSlug && finalSlug.length > 60) {
      errors.push("Slug must be 60 characters or fewer.");
    }

    // Check for slug conflict (skip if unchanged)
    if (selectedTenant && finalSlug && finalSlug !== (selectedTenant.slug || "")) {
      setSlugChecking(true);
      try {
        const { data, error } = await db
          .from("tenants")
          .select("id", { count: "exact", head: true })
          .eq("slug", finalSlug);
        if (!error && data !== null && (data as unknown as number) > 0) {
          errors.push(`Slug "${finalSlug}" is already taken by another tenant.`);
        }
      } finally {
        setSlugChecking(false);
      }
    }

    setRenameErrors(errors);
    return errors.length === 0;
  };

  const handleRename = async () => {
    if (!selectedTenant) return;

    const isValid = await validateRename();
    if (!isValid) return;

    const trimmedName = editedName.trim();
    const finalSlug = (editedSlug.trim() || generateSlug(trimmedName)) || null;

    setActionLoading(true);
    try {
      const { error } = await db
        .from("tenants")
        .update({ name: trimmedName, slug: finalSlug })
        .eq("id", selectedTenant.id);
      if (error) {
        if (error.code === "23505" && error.message?.includes("slug")) {
          toast.error(`Slug "${finalSlug}" is already taken. Please use a different slug.`);
          return;
        }
        throw error;
      }
      await logTenantRename(
        selectedTenant.id,
        { name: selectedTenant.name, slug: selectedTenant.slug },
        { name: trimmedName, slug: finalSlug }
      );
      toast.success("Tenant renamed");
      setRenameDialogOpen(false);
      setSelectedTenant(null);
      fetchTenants();

      // If the renamed tenant is the user's currently active tenant, refresh
      // the auth snapshot so the header updates immediately.
      if (selectedTenant.id === activeTenant?.id) {
        await refreshProfile();
        // Invalidate tenant-scoped caches (branches, restaurants, dashboard
        // labels) so any consumer with a stale tenant name re-renders.
        await qc.invalidateQueries();
        // Notify other tabs listening for tenant changes.
        window.dispatchEvent(new CustomEvent("tenant-renamed", {
          detail: { tenantId: selectedTenant.id, name: trimmedName, slug: finalSlug },
        }));
      }
    } catch (error) {
      console.error("Error renaming tenant:", error);
      toast.error("Failed to rename tenant");
    } finally {
      setActionLoading(false);
    }
  };

  const openManageDialog = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setEditedPlanId(tenant.plan_id);
    
    // Initialize features from plan defaults + tenant overrides
    const planFlags = tenant.plan?.default_feature_flags || {};
    const features: Record<string, boolean> = { ...planFlags };
    tenant.features?.forEach((f) => {
      features[f.feature_key] = f.enabled;
    });
    setEditedFeatures(features);
    setManageDialogOpen(true);
  };

  const openBranchDialog = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setBranchTenantId(tenant.id);
    const firstRestaurantId = tenant.restaurants?.[0]?.id ?? "";
    setBranchRestaurantId(firstRestaurantId);
    setBranchForm({ name: "", code: "", address: "", phone: "" });
    setBranchDialogOpen(true);
  };

  const handleCreateBranch = async () => {
    if (!branchTenantId) return;
    if (!branchRestaurantId) {
      toast.error("This tenant has no restaurant to attach a branch to.");
      return;
    }
    if (!branchForm.name.trim()) {
      toast.error("Branch name is required");
      return;
    }
    setActionLoading(true);
    try {
      const { data, error } = await db.functions.invoke("create-branch", {
        body: {
          restaurant_id: branchRestaurantId,
          name: branchForm.name.trim(),
          code: branchForm.code.trim() || null,
          address: branchForm.address.trim() || null,
          phone: branchForm.phone.trim() || null,
        },
      });
      if (error) {
        // Surface server-side validation messages when available
        const fieldErrs = (data as any)?.fieldErrors;
        const msg = fieldErrs
          ? Object.values(fieldErrs).join(" · ")
          : (data as any)?.error || error.message;
        throw new Error(msg);
      }
      const createdName = (data as any)?.branch?.name ?? branchForm.name.trim();
      const isPrimary = (data as any)?.branch?.is_primary;
      toast.success(
        `Branch "${createdName}" created${isPrimary ? " (set as primary)" : ""}`,
      );
      setBranchDialogOpen(false);
      // Invalidate any cached branch lists so the tenant sees it instantly
      await qc.invalidateQueries({ queryKey: ["branches"] });
    } catch (err: any) {
      console.error("Error creating branch:", err);
      toast.error(err?.message || "Failed to create branch");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveManagement = async () => {
    if (!selectedTenant) return;
    setActionLoading(true);

    try {
      // Update tenant plan
      if (editedPlanId !== selectedTenant.plan_id) {
        const { error } = await db
          .from("tenants")
          .update({ plan_id: editedPlanId })
          .eq("id", selectedTenant.id);
        if (error) throw error;
      }

      // Update feature flags
      for (const [key, enabled] of Object.entries(editedFeatures)) {
        const existing = selectedTenant.features?.find(f => f.feature_key === key);
        
        if (existing) {
          await db
            .from("tenant_features")
            .update({ enabled })
            .eq("id", existing.id);
        } else {
          await db
            .from("tenant_features")
            .insert({
              tenant_id: selectedTenant.id,
              feature_key: key,
              enabled,
            });
        }
      }

      toast.success("Tenant settings saved");
      setManageDialogOpen(false);
      fetchTenants();
    } catch (error) {
      console.error("Error saving tenant settings:", error);
      toast.error("Failed to save settings");
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status: string, tenant?: Tenant) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      active: "default",
      suspended: "destructive",
      trial: "secondary",
      archived: "outline",
    };

    return (
      <div className="flex items-center gap-2">
        <Badge variant={variants[status] || "outline"} className="capitalize">
          {status}
        </Badge>
        {status === "trial" && tenant?.trial_ends_at && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {differenceInDays(new Date(tenant.trial_ends_at), new Date())}d left
          </span>
        )}
      </div>
    );
  };

  const handleViewAsTenant = async (tenant: Tenant) => {
    await startImpersonation(tenant.id);
    navigate("/dashboard");
  };

  const getPlanBadge = (plan: Plan | null | undefined) => {
    if (!plan) return <span className="text-muted-foreground text-xs">No plan</span>;
    
    const colors: Record<string, string> = {
      free: "bg-muted text-muted-foreground",
      pro: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
      enterprise: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    };

    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${colors[plan.name.toLowerCase()] || colors.free}`}>
        {plan.name}
      </span>
    );
  };

  const filteredTenants = tenants.filter((tenant) => {
    const matchesSearch = tenant.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || tenant.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Tenant Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            View and manage all tenants, their plans, and feature flags.
          </p>
        </div>

        <Card className="border-border/40">
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <CardTitle className="text-lg font-medium">All Tenants</CardTitle>
                <CardDescription>{tenants.length} total tenants</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search tenants..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 w-64"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                    <SelectItem value="trial">Trial</SelectItem>
                  </SelectContent>
                </Select>
                <CreateTenantDialog plans={plans} onCreated={fetchTenants} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border/40">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Locations</TableHead>
                    <TableHead>Users</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        Loading tenants...
                      </TableCell>
                    </TableRow>
                  ) : filteredTenants.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No tenants found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTenants.map((tenant) => (
                      <TableRow key={tenant.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center">
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{tenant.name}</p>
                              <p className="text-xs text-muted-foreground">{tenant.slug || "No slug"}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(tenant.status, tenant)}</TableCell>
                        <TableCell>{getPlanBadge(tenant.plan)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Store className="h-3 w-3" />
                            <span>{tenant.restaurant_count}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {tenant.user_count}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(tenant.created_at), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => navigate(`/admin/tenants/${tenant.id}`)}>
                                <FileText className="h-4 w-4 mr-2" />
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openRenameDialog(tenant)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit Name
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleViewAsTenant(tenant)}>
                                <Eye className="h-4 w-4 mr-2" />
                                View as Tenant
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openManageDialog(tenant)}>
                                <Settings2 className="h-4 w-4 mr-2" />
                                Manage Plan & Features
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openBranchDialog(tenant)}>
                                <Plus className="h-4 w-4 mr-2" />
                                Create Branch
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {tenant.status === "active" || tenant.status === "trial" ? (
                                <DropdownMenuItem
                                  onClick={() => openSuspendDialog(tenant)}
                                  className="text-destructive"
                                >
                                  <PowerOff className="h-4 w-4 mr-2" />
                                  Suspend Tenant
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => handleActivate(tenant)}>
                                  <Power className="h-4 w-4 mr-2" />
                                  Activate Tenant
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={(open) => {
        if (!open) setRenameErrors([]);
        setRenameDialogOpen(open);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Tenant Name</DialogTitle>
            <DialogDescription>
              Update the display name and slug for this tenant.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="tenant-name">Tenant Name</Label>
              <Input
                id="tenant-name"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                placeholder="Acme Restaurant Group"
                disabled={actionLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tenant-slug">Slug</Label>
              <Input
                id="tenant-slug"
                value={editedSlug}
                onChange={(e) => {
                  setEditedSlug(e.target.value);
                  setSlugTouched(true);
                  setRenameErrors([]);
                }}
                placeholder="acme-restaurant-group"
                disabled={actionLoading}
              />
              {slugChecking && (
                <p className="text-xs text-muted-foreground">Checking availability…</p>
              )}
              {!slugChecking && editedSlug.trim() && (
                <div className="flex items-center gap-1.5 text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="text-emerald-600">
                    Will be saved as: <span className="font-mono font-medium">{editedSlug.trim() || generateSlug(editedName.trim())}</span>
                  </span>
                </div>
              )}
            </div>

            {renameErrors.length > 0 && (
              <div className="rounded-md bg-destructive/10 p-3 space-y-1">
                {renameErrors.map((err, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{err}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRenameDialogOpen(false);
                setRenameErrors([]);
              }}
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={actionLoading || slugChecking || renameErrors.length > 0}>
              {actionLoading ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspend Dialog */}
      <Dialog open={suspendDialogOpen} onOpenChange={setSuspendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend Tenant</DialogTitle>
            <DialogDescription>
              Are you sure you want to suspend {selectedTenant?.name}? 
              Users will see a maintenance message and won't be able to access the app.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Reason (optional)</Label>
              <Textarea
                id="reason"
                placeholder="Enter reason for suspension..."
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSuspendDialogOpen(false)}
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleSuspend}
              disabled={actionLoading}
            >
              {actionLoading ? "Suspending..." : "Suspend Tenant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Plan & Features Dialog */}
      <Dialog open={manageDialogOpen} onOpenChange={setManageDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Manage {selectedTenant?.name}</DialogTitle>
            <DialogDescription>
              Configure subscription plan and feature access for this tenant.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4 overflow-y-auto flex-1">
            {/* Plan Selection */}
            <div className="space-y-2">
              <Label>Subscription Plan</Label>
              <Select value={editedPlanId || ""} onValueChange={handlePlanChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a plan" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      <span className="flex items-center gap-2">
                        {plan.name}
                        <span className="text-muted-foreground text-xs">
                          ${plan.price}/mo
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Feature Flags */}
            <div className="space-y-4">
              <Label>Feature Flags</Label>
              <p className="text-xs text-muted-foreground">
                Override plan defaults for this specific tenant.
              </p>
              <div className="space-y-3">
                {FEATURE_FLAGS.map((flag) => (
                  <div key={flag.key} className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-medium">{flag.label}</Label>
                      <p className="text-xs text-muted-foreground">{flag.description}</p>
                    </div>
                    <Switch
                      checked={editedFeatures[flag.key] ?? false}
                      onCheckedChange={(checked) =>
                        setEditedFeatures((prev) => ({ ...prev, [flag.key]: checked }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setManageDialogOpen(false)}
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveManagement} disabled={actionLoading}>
              {actionLoading ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Branch Dialog */}
      <Dialog open={branchDialogOpen} onOpenChange={setBranchDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create branch</DialogTitle>
            <DialogDescription>
              Add a new physical location under a tenant. Branches are attached to a
              specific restaurant.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="branch-tenant">Tenant</Label>
              <Select
                value={branchTenantId}
                onValueChange={(id) => {
                  setBranchTenantId(id);
                  const t = tenants.find((tn) => tn.id === id);
                  const firstRestaurantId = t?.restaurants?.[0]?.id ?? "";
                  setBranchRestaurantId(firstRestaurantId);
                }}
                disabled={actionLoading}
              >
                <SelectTrigger id="branch-tenant">
                  <SelectValue placeholder="Select a tenant" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-restaurant">Restaurant</Label>
              <Select
                value={branchRestaurantId}
                onValueChange={setBranchRestaurantId}
                disabled={actionLoading || !branchTenantId}
              >
                <SelectTrigger id="branch-restaurant">
                  <SelectValue placeholder="Select a restaurant" />
                </SelectTrigger>
                <SelectContent>
                  {tenants
                    .find((t) => t.id === branchTenantId)
                    ?.restaurants?.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {branchTenantId &&
                !tenants.find((t) => t.id === branchTenantId)?.restaurants
                  ?.length && (
                  <p className="text-xs text-destructive">
                    This tenant has no restaurants yet - create one first.
                  </p>
                )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-branch-name">Branch name</Label>
              <Input
                id="new-branch-name"
                value={branchForm.name}
                onChange={(e) => setBranchForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Jeddah - Tahlia"
                disabled={actionLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-branch-code">Short code (optional)</Label>
              <Input
                id="new-branch-code"
                value={branchForm.code}
                onChange={(e) =>
                  setBranchForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                }
                placeholder="JED-01"
                maxLength={16}
                disabled={actionLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-branch-address">Address (optional)</Label>
              <Input
                id="new-branch-address"
                value={branchForm.address}
                onChange={(e) => setBranchForm((f) => ({ ...f, address: e.target.value }))}
                disabled={actionLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-branch-phone">Phone (optional)</Label>
              <Input
                id="new-branch-phone"
                value={branchForm.phone}
                onChange={(e) => setBranchForm((f) => ({ ...f, phone: e.target.value }))}
                disabled={actionLoading}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBranchDialogOpen(false)}
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateBranch}
              disabled={actionLoading || !branchRestaurantId || !branchForm.name.trim()}
            >
              {actionLoading ? "Creating…" : "Create branch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
