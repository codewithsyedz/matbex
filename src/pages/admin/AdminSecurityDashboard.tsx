import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db } from "@/integrations/db/client";
import { Shield, Users, Lock, FileDown, AlertTriangle, CheckCircle, XCircle, RefreshCw, Unlock } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

interface SecurityStats {
  totalUsers: number;
  mfaEnabledUsers: number;
  mfaAdoptionRate: number;
  activeSessions: number;
  totalTenants: number;
  pendingExports: number;
  approvedExports: number;
  rejectedExports: number;
  lockedAccounts: number;
  recentFailedLogins: number;
}

interface LoginAttempt {
  id: string;
  email: string;
  ip_address: string | null;
  user_agent: string | null;
  success: boolean;
  failure_reason: string | null;
  created_at: string;
}

interface AccountLock {
  id: string;
  email: string;
  locked_at: string;
  locked_until: string;
  lock_reason: string;
  failed_attempts: number;
  unlocked_at: string | null;
}

export default function AdminSecurityDashboard() {
  const [stats, setStats] = useState<SecurityStats | null>(null);
  const [loginAttempts, setLoginAttempts] = useState<LoginAttempt[]>([]);
  const [accountLocks, setAccountLocks] = useState<AccountLock[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetchSecurityData();
  }, []);

  const fetchSecurityData = async () => {
    setLoading(true);
    try {
      // Fetch stats in parallel
      const [
        { count: totalTenants },
        { count: activeSessions },
        { count: pendingExports },
        { count: approvedExports },
        { count: rejectedExports },
        { data: locksData },
        { data: attemptsData },
      ] = await Promise.all([
        db.from("tenants").select("*", { count: "exact", head: true }),
        db.from("user_sessions").select("*", { count: "exact", head: true }).eq("is_active", true),
        db.from("export_requests").select("*", { count: "exact", head: true }).eq("status", "pending"),
        db.from("export_requests").select("*", { count: "exact", head: true }).eq("status", "approved"),
        db.from("export_requests").select("*", { count: "exact", head: true }).eq("status", "rejected"),
        db.from("account_locks").select("*").is("unlocked_at", null).order("locked_at", { ascending: false }),
        db.from("login_attempts").select("*").order("created_at", { ascending: false }).limit(100),
      ]);

      // Calculate failed logins in last 24 hours
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const recentFailedLogins = attemptsData?.filter(
        a => !a.success && new Date(a.created_at) > yesterday
      ).length || 0;

      // Note: MFA stats would require querying auth.mfa_factors which we can't access directly
      // This would need a database function or edge function to get accurate MFA stats
      setStats({
        totalUsers: 0, // Would need admin API access
        mfaEnabledUsers: 0,
        mfaAdoptionRate: 0,
        activeSessions: activeSessions || 0,
        totalTenants: totalTenants || 0,
        pendingExports: pendingExports || 0,
        approvedExports: approvedExports || 0,
        rejectedExports: rejectedExports || 0,
        lockedAccounts: locksData?.length || 0,
        recentFailedLogins,
      });

      setAccountLocks(locksData || []);
      setLoginAttempts(attemptsData || []);
    } catch (error) {
      console.error("Error fetching security data:", error);
      toast.error("Failed to load security data");
    } finally {
      setLoading(false);
    }
  };

  const handleUnlockAccount = async (lockId: string, email: string) => {
    try {
      const { error } = await db
        .from("account_locks")
        .update({ unlocked_at: new Date().toISOString() })
        .eq("id", lockId);

      if (error) throw error;
      toast.success(`Account ${email} unlocked`);
      fetchSecurityData();
    } catch (error) {
      console.error("Error unlocking account:", error);
      toast.error("Failed to unlock account");
    }
  };

  const filteredAttempts = loginAttempts.filter(attempt =>
    attempt.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    attempt.ip_address?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Security Dashboard</h1>
          <p className="text-muted-foreground">Monitor security metrics across all tenants</p>
        </div>
        <Button onClick={fetchSecurityData} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Sessions</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.activeSessions}</div>
            <p className="text-xs text-muted-foreground">Across {stats?.totalTenants} tenants</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Locked Accounts</CardTitle>
            <Lock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.lockedAccounts}</div>
            <p className="text-xs text-muted-foreground">{stats?.recentFailedLogins} failed logins (24h)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Export Requests</CardTitle>
            <FileDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.pendingExports}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.approvedExports} approved, {stats?.rejectedExports} rejected
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Security Status</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {(stats?.lockedAccounts || 0) > 0 ? (
                <Badge variant="destructive">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Attention Needed
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  All Clear
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="locks" className="space-y-4">
        <TabsList>
          <TabsTrigger value="locks">Account Locks</TabsTrigger>
          <TabsTrigger value="attempts">Login Attempts</TabsTrigger>
        </TabsList>

        <TabsContent value="locks" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Locked Accounts</CardTitle>
              <CardDescription>Accounts locked due to suspicious activity</CardDescription>
            </CardHeader>
            <CardContent>
              {accountLocks.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Lock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No locked accounts</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Locked At</TableHead>
                      <TableHead>Locked Until</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Failed Attempts</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accountLocks.map((lock) => (
                      <TableRow key={lock.id}>
                        <TableCell className="font-medium">{lock.email}</TableCell>
                        <TableCell>{format(new Date(lock.locked_at), "MMM d, HH:mm")}</TableCell>
                        <TableCell>{format(new Date(lock.locked_until), "MMM d, HH:mm")}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{lock.lock_reason}</TableCell>
                        <TableCell>{lock.failed_attempts}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUnlockAccount(lock.id, lock.email)}
                          >
                            <Unlock className="h-4 w-4 mr-1" />
                            Unlock
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attempts" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Login Attempts</CardTitle>
                  <CardDescription>Recent login activity across all users</CardDescription>
                </div>
                <Input
                  placeholder="Search by email or IP..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="max-w-xs"
                />
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAttempts.map((attempt) => (
                    <TableRow key={attempt.id}>
                      <TableCell>{format(new Date(attempt.created_at), "MMM d, HH:mm:ss")}</TableCell>
                      <TableCell className="font-medium">{attempt.email}</TableCell>
                      <TableCell className="font-mono text-sm">{attempt.ip_address || "-"}</TableCell>
                      <TableCell>
                        {attempt.success ? (
                          <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Success
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <XCircle className="h-3 w-3 mr-1" />
                            Failed
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{attempt.failure_reason || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
