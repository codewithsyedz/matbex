import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { db } from "@/integrations/db/client";
import { useSuperAdmin } from "@/contexts/SuperAdminContext";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  Users,
  Store,
  Calendar,
  Activity,
  TrendingUp,
  Clock,
  DollarSign,
  FileText,
  Settings2,
  Shield,
  Download,
  Eye,
  KeyRound,
  Loader2,
} from "lucide-react";
import { format, differenceInDays, subDays } from "date-fns";
import { TenantSessionsManager } from "@/components/admin/TenantSessionsManager";
import { TenantExportRequests } from "@/components/admin/TenantExportRequests";
import { TenantUsersManager } from "@/components/admin/TenantUsersManager";
import { TenantChatSettings } from "@/components/admin/TenantChatSettings";
import { TenantFeatureToggles } from "@/components/admin/TenantFeatureToggles";
import { TenantAddonsManager } from "@/components/admin/TenantAddonsManager";
import { TenantBranchesManager } from "@/components/admin/TenantBranchesManager";
import { TenantLocationsManager } from "@/components/admin/TenantLocationsManager";
import { TenantDataResidency } from "@/components/admin/TenantDataResidency";

interface ActivityLog {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  user_id: string | null;
}

interface Restaurant {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

interface TenantUser {
  user_id: string;
  role: string;
  profile?: {
    full_name: string | null;
  };
}

interface Plan {
  id: string;
  name: string;
  price: number;
}

interface UsageMetrics {
  totalShifts: number;
  totalSales: number;
  totalTransactions: number;
  activeUsers: number;
}

interface Tenant {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  plan_id: string | null;
  created_at: string;
  updated_at: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  trial_ends_at: string | null;
  settings: Record<string, unknown>;
  plan?: Plan | null;
}

export default function AdminTenantDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { startImpersonation } = useSuperAdmin();
  const [loading, setLoading] = useState(true);
  const [resendingCreds, setResendingCreds] = useState(false);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [metrics, setMetrics] = useState<UsageMetrics>({
    totalShifts: 0,
    totalSales: 0,
    totalTransactions: 0,
    activeUsers: 0,
  });

  const fetchTenantDetails = async () => {
    if (!id) return;

    try {
      // Fetch tenant
      const { data: tenantData, error: tenantError } = await db
        .from("tenants")
        .select("*")
        .eq("id", id)
        .single();

      if (tenantError) throw tenantError;

      // Fetch plan
      let planData = null;
      if (tenantData.plan_id) {
        const { data } = await db
          .from("plans")
          .select("id, name, price")
          .eq("id", tenantData.plan_id)
          .single();
        planData = data;
      }

      setTenant({ ...tenantData, plan: planData, settings: tenantData.settings as Record<string, unknown> || {} });

      // Fetch restaurants
      const { data: restaurantsData } = await db
        .from("restaurants")
        .select("id, name, status, created_at")
        .eq("tenant_id", id)
        .order("created_at", { ascending: false });

      setRestaurants(restaurantsData || []);

      // Fetch users with roles
      const { data: usersData } = await db
        .from("user_tenant_roles")
        .select("user_id, role")
        .eq("tenant_id", id);

      // Fetch profiles for users
      if (usersData && usersData.length > 0) {
        const userIds = usersData.map((u) => u.user_id);
        const { data: profiles } = await db
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);

        const usersWithProfiles = usersData.map((u) => ({
          ...u,
          profile: profiles?.find((p) => p.id === u.user_id),
        }));
        setUsers(usersWithProfiles);
      }

      // Fetch activity logs
      const { data: logsData } = await db
        .from("tenant_activity_logs")
        .select("*")
        .eq("tenant_id", id)
        .order("created_at", { ascending: false })
        .limit(50);

      setActivityLogs((logsData || []).map(log => ({
        ...log,
        metadata: log.metadata as Record<string, unknown> || {}
      })));

      // Fetch usage metrics (last 30 days)
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
      const restaurantIds = (restaurantsData || []).map((r) => r.id);

      if (restaurantIds.length > 0) {
        // Total shifts
        const { count: shiftsCount } = await db
          .from("shifts")
          .select("*", { count: "exact", head: true })
          .in("restaurant_id", restaurantIds)
          .gte("created_at", thirtyDaysAgo);

        // Total sales transactions
        const { count: transactionsCount } = await db
          .from("sales_transactions")
          .select("*", { count: "exact", head: true })
          .in("restaurant_id", restaurantIds)
          .gte("created_at", thirtyDaysAgo);

        // Total sales value
        const { data: salesData } = await db
          .from("sales_transactions")
          .select("total")
          .in("restaurant_id", restaurantIds)
          .gte("created_at", thirtyDaysAgo);

        const totalSales = salesData?.reduce((sum, s) => sum + (s.total || 0), 0) || 0;

        setMetrics({
          totalShifts: shiftsCount || 0,
          totalSales,
          totalTransactions: transactionsCount || 0,
          activeUsers: usersData?.length || 0,
        });
      }
    } catch (error) {
      console.error("Error fetching tenant details:", error);
      toast.error("Failed to load tenant details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenantDetails();
  }, [id]);

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      active: "default",
      suspended: "destructive",
      trial: "secondary",
      archived: "outline",
    };
    return <Badge variant={variants[status] || "outline"} className="capitalize">{status}</Badge>;
  };

  const getActionLabel = (action: string): string => {
    const labels: Record<string, string> = {
      status_changed: "Status Changed",
      plan_changed: "Plan Changed",
      user_added: "User Added",
      user_removed: "User Removed",
      restaurant_created: "Restaurant Created",
      feature_toggled: "Feature Toggled",
      login: "User Login",
      settings_updated: "Settings Updated",
    };
    return labels[action] || action.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const formatMetadata = (metadata: Record<string, unknown>): string => {
    if (!metadata || Object.keys(metadata).length === 0) return "";
    return Object.entries(metadata)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading tenant details...</div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">Tenant not found</p>
        <Button variant="outline" onClick={() => navigate("/admin/tenants")}>
          Back to Tenants
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin/tenants")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center">
                <Building2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                  {tenant.name}
                </h1>
                <p className="text-sm text-muted-foreground">{tenant.slug || "No slug"}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await startImpersonation(tenant.id);
                navigate("/dashboard");
              }}
            >
              <Eye className="h-4 w-4 mr-2" />
              View as Tenant
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={resendingCreds}
              onClick={async () => {
                if (
                  !window.confirm(
                    `Generate a new temporary password for ${tenant.name} and email it to the workspace owner? The current password will stop working immediately.`,
                  )
                ) return;
                setResendingCreds(true);
                try {
                  const { data, error } = await db.functions.invoke(
                    "admin-resend-trial-credentials",
                    { body: { tenant_id: tenant.id } },
                  );
                  if (error) throw error;
                  if ((data as any)?.error) throw new Error((data as any).error);
                  const payload = data as {
                    email: string;
                    email_delivered: boolean;
                    email_error?: string | null;
                    temporary_password: string;
                  };
                  if (payload.email_delivered) {
                    toast.success(`Credentials emailed to ${payload.email}`);
                  } else {
                    toast.warning(
                      `Password reset, but email failed: ${payload.email_error ?? "unknown"}. Temp password: ${payload.temporary_password}`,
                      { duration: 20000 },
                    );
                  }
                } catch (e: any) {
                  toast.error(e?.message || "Failed to resend credentials");
                } finally {
                  setResendingCreds(false);
                }
              }}
            >
              {resendingCreds ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4 mr-2" />
              )}
              Resend Credentials
            </Button>
            {getStatusBadge(tenant.status)}
            {tenant.plan && (
              <Badge variant="outline" className="capitalize">
                {tenant.plan.name}
              </Badge>
            )}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="border-border/40">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center">
                  <Store className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{restaurants.length}</p>
                  <p className="text-xs text-muted-foreground">Locations</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/40">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-md bg-blue-500/10 flex items-center justify-center">
                  <Users className="h-4 w-4 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{users.length}</p>
                  <p className="text-xs text-muted-foreground">Users</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/40">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-md bg-green-500/10 flex items-center justify-center">
                  <DollarSign className="h-4 w-4 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{metrics.totalSales.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Sales (30d)</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/40">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-md bg-amber-500/10 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-amber-500" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{metrics.totalTransactions}</p>
                  <p className="text-xs text-muted-foreground">Transactions (30d)</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Activity Log</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="exports">Exports</TabsTrigger>
            <TabsTrigger value="locations">Locations</TabsTrigger>
            <TabsTrigger value="branches">Branches</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="modules">Modules</TabsTrigger>
            <TabsTrigger value="addons">Addons</TabsTrigger>
            <TabsTrigger value="residency">Residency</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Tenant Info */}
              <Card className="border-border/40">
                <CardHeader>
                  <CardTitle className="text-base font-medium">Tenant Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Created</p>
                      <p className="font-medium">{format(new Date(tenant.created_at), "MMM d, yyyy")}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Plan</p>
                      <p className="font-medium capitalize">{tenant.plan?.name || "No plan"}</p>
                    </div>
                    {tenant.trial_ends_at && (
                      <div>
                        <p className="text-muted-foreground">Trial Ends</p>
                        <p className="font-medium">
                          {format(new Date(tenant.trial_ends_at), "MMM d, yyyy")}
                          <span className="text-muted-foreground ml-1">
                            ({differenceInDays(new Date(tenant.trial_ends_at), new Date())} days left)
                          </span>
                        </p>
                      </div>
                    )}
                    {tenant.suspended_at && (
                      <div className="col-span-2">
                        <p className="text-muted-foreground">Suspended</p>
                        <p className="font-medium text-destructive">
                          {format(new Date(tenant.suspended_at), "MMM d, yyyy")}
                          {tenant.suspended_reason && ` - ${tenant.suspended_reason}`}
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Usage Metrics */}
              <Card className="border-border/40">
                <CardHeader>
                  <CardTitle className="text-base font-medium">Usage Metrics (Last 30 Days)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Total Shifts</p>
                      <p className="font-medium">{metrics.totalShifts}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Transactions</p>
                      <p className="font-medium">{metrics.totalTransactions}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Total Sales</p>
                      <p className="font-medium">{metrics.totalSales.toLocaleString()} SAR</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Active Users</p>
                      <p className="font-medium">{metrics.activeUsers}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Recent Activity */}
            <Card className="border-border/40">
              <CardHeader>
                <CardTitle className="text-base font-medium">Recent Activity</CardTitle>
                <CardDescription>Last 10 activity events</CardDescription>
              </CardHeader>
              <CardContent>
                {activityLogs.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No activity recorded yet</p>
                ) : (
                  <div className="space-y-3">
                    {activityLogs.slice(0, 10).map((log) => (
                      <div key={log.id} className="flex items-start gap-3 text-sm">
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium">{getActionLabel(log.action)}</p>
                          {formatMetadata(log.metadata) && (
                            <p className="text-muted-foreground truncate">{formatMetadata(log.metadata)}</p>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {format(new Date(log.created_at), "MMM d, HH:mm")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activity">
            <Card className="border-border/40">
              <CardHeader>
                <CardTitle className="text-base font-medium">Activity Log</CardTitle>
                <CardDescription>Complete history of tenant activities</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Action</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activityLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                          No activity recorded yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      activityLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="font-medium">{getActionLabel(log.action)}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatMetadata(log.metadata) || "-"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {format(new Date(log.created_at), "MMM d, yyyy HH:mm")}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="locations">
            <TenantLocationsManager tenantId={tenant.id} onChanged={fetchTenantDetails} />
          </TabsContent>

          <TabsContent value="sessions">
            <TenantSessionsManager tenantId={tenant.id} />
          </TabsContent>

          <TabsContent value="exports">
            <TenantExportRequests tenantId={tenant.id} />
          </TabsContent>

          <TabsContent value="users">
            <TenantUsersManager tenantId={tenant.id} onUserAdded={fetchTenantDetails} />
          </TabsContent>

          <TabsContent value="chat">
            <TenantChatSettings tenantId={tenant.id} />
          </TabsContent>

          <TabsContent value="modules">
            <TenantFeatureToggles tenantId={tenant.id} planId={tenant.plan_id} />
          </TabsContent>

          <TabsContent value="addons">
            <TenantAddonsManager tenantId={tenant.id} />
          </TabsContent>

          <TabsContent value="branches">
            <TenantBranchesManager
              restaurants={restaurants.map((r) => ({ id: r.id, name: r.name }))}
            />
          </TabsContent>

          <TabsContent value="residency">
            <TenantDataResidency tenantId={tenant.id} tenantName={tenant.name} />
          </TabsContent>
        </Tabs>
      </div>
  );
}
