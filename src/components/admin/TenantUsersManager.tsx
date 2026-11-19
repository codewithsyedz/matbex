import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";
import { UserPlus, MoreHorizontal, Trash2, Shield, KeyRound, AlertTriangle, Crown } from "lucide-react";
import { format } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface TenantUser {
  user_id: string;
  role: string;
  created_at: string;
  profile?: {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
  };
  email?: string;
}

interface TenantUsersManagerProps {
  tenantId: string;
  onUserAdded?: () => void;
}

const ROLES = [
  { value: "owner", label: "Owner", description: "Full access to all features" },
  { value: "manager", label: "Manager", description: "Can manage operations" },
  { value: "cashier", label: "Cashier", description: "Basic POS access" },
  { value: "accountant", label: "Accountant", description: "Finance & accounting access" },
];

export function TenantUsersManager({ tenantId, onUserAdded }: TenantUsersManagerProps) {
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [changeRoleDialogOpen, setChangeRoleDialogOpen] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<TenantUser | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<string>("manager");
  const [newFullName, setNewFullName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      
      // Fetch users with roles for this tenant
      const { data: rolesData, error: rolesError } = await db
        .from("user_tenant_roles")
        .select("user_id, role, created_at")
        .eq("tenant_id", tenantId);

      if (rolesError) throw rolesError;

      if (!rolesData || rolesData.length === 0) {
        setUsers([]);
        return;
      }

      // Fetch profiles for users
      const userIds = rolesData.map((r) => r.user_id);
      const { data: profiles } = await db
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", userIds);

      // Combine data
      const usersWithProfiles = rolesData.map((role) => ({
        ...role,
        profile: profiles?.find((p) => p.id === role.user_id),
      }));

      setUsers(usersWithProfiles);
    } catch (error) {
      console.error("Error fetching users:", error);
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [tenantId]);

  const handleAddUser = async () => {
    if (!newEmail.trim()) {
      toast.error("Please enter an email address");
      return;
    }

    setSubmitting(true);
    try {
      // Check tenant quota before adding user
      const { data: quotaData, error: quotaError } = await db.rpc("check_quota", {
        p_tenant_id: tenantId,
        p_quota_type: "users",
        p_increment: 1,
      });

      const quotaResult = quotaData as unknown as { allowed: boolean; current: number; limit: number } | null;

      if (quotaError) {
        console.error("Error checking quota:", quotaError);
      } else if (quotaResult && !quotaResult.allowed) {
        toast.error(`User limit reached for this tenant (${quotaResult.current}/${quotaResult.limit}). Upgrade the tenant's plan to add more users.`);
        setSubmitting(false);
        return;
      }

      // Also check role-specific quota
      const { data: roleQuotaData, error: roleQuotaError } = await db.rpc("check_quota", {
        p_tenant_id: tenantId,
        p_quota_type: newRole,
        p_increment: 1,
      });

      const roleQuotaResult = roleQuotaData as unknown as { allowed: boolean; current: number; limit: number } | null;

      if (roleQuotaError) {
        console.error("Error checking role quota:", roleQuotaError);
      } else if (roleQuotaResult && !roleQuotaResult.allowed) {
        toast.error(`${newRole.charAt(0).toUpperCase() + newRole.slice(1)} limit reached for this tenant (${roleQuotaResult.current}/${roleQuotaResult.limit}). Upgrade the tenant's plan.`);
        setSubmitting(false);
        return;
      }

      // Create user directly using admin API (no email sent)
      const { data, error } = await db.functions.invoke("create-tenant-user", {
        body: {
          email: newEmail.trim(),
          role: newRole,
          tenant_id: tenantId,
          full_name: newFullName.trim() || undefined,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const message = data?.is_new_user 
        ? "New user created and added to tenant" 
        : "Existing user added to tenant";
      toast.success(message);
      setAddDialogOpen(false);
      setNewEmail("");
      setNewRole("manager");
      setNewFullName("");
      fetchUsers();
      onUserAdded?.();
    } catch (error: any) {
      console.error("Error adding user:", error);
      toast.error(error.message || "Failed to add user");
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangeRole = async () => {
    if (!selectedUser) return;

    setSubmitting(true);
    try {
      const { error } = await db
        .from("user_tenant_roles")
        .update({ role: newRole as "owner" | "manager" | "cashier" | "accountant" })
        .eq("user_id", selectedUser.user_id)
        .eq("tenant_id", tenantId);

      if (error) throw error;

      toast.success("Role updated successfully");
      setChangeRoleDialogOpen(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (error: any) {
      console.error("Error changing role:", error);
      toast.error(error.message || "Failed to change role");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGrantOwnership = async (user: TenantUser) => {
    if (user.role === "owner") {
      toast.info("This user is already an owner");
      return;
    }
    if (!confirm(`Grant ownership to ${user.profile?.full_name || "this user"}? They will become a co-owner alongside the existing owner(s).`)) {
      return;
    }
    try {
      const { data, error } = await (db as any).rpc("grant_tenant_ownership", {
        _tenant_id: tenantId,
        _target_user_id: user.user_id,
      });
      if (error) throw error;
      toast.success(`Ownership granted (${data?.restaurants_granted ?? 0} restaurants updated)`);
      fetchUsers();
    } catch (error: any) {
      console.error("Error granting ownership:", error);
      toast.error(error.message || "Failed to grant ownership");
    }
  };

  const handleRemoveUser = async (user: TenantUser) => {
    if (!confirm(`Are you sure you want to remove ${user.profile?.full_name || "this user"} from this tenant?`)) {
      return;
    }

    try {
      // Remove from user_tenant_roles
      const { error: roleError } = await db
        .from("user_tenant_roles")
        .delete()
        .eq("user_id", user.user_id)
        .eq("tenant_id", tenantId);

      if (roleError) throw roleError;

      // Also remove from user_roles for all restaurants in this tenant
      const { data: restaurants } = await db
        .from("restaurants")
        .select("id")
        .eq("tenant_id", tenantId);

      if (restaurants && restaurants.length > 0) {
        const restaurantIds = restaurants.map((r) => r.id);
        await db
          .from("user_roles")
          .delete()
          .eq("user_id", user.user_id)
          .in("restaurant_id", restaurantIds);
      }

      // Update profile to remove tenant association
      await db
        .from("profiles")
        .update({ tenant_id: null, restaurant_id: null })
        .eq("id", user.user_id)
        .eq("tenant_id", tenantId);

      toast.success("User removed successfully");
      fetchUsers();
    } catch (error: any) {
      console.error("Error removing user:", error);
      toast.error(error.message || "Failed to remove user");
    }
  };

  const openChangeRoleDialog = (user: TenantUser) => {
    setSelectedUser(user);
    setNewRole(user.role);
    setChangeRoleDialogOpen(true);
  };

  const openResetPasswordDialog = (user: TenantUser) => {
    setSelectedUser(user);
    setNewPassword("");
    setResetPasswordDialogOpen(true);
  };

  const handleResetPassword = async () => {
    if (!selectedUser) return;

    if (!newPassword.trim()) {
      toast.error("Please enter a new password");
      return;
    }

    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await db.functions.invoke("admin-reset-password", {
        body: {
          user_id: selectedUser.user_id,
          new_password: newPassword,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success("Password reset successfully");
      setResetPasswordDialogOpen(false);
      setSelectedUser(null);
      setNewPassword("");
    } catch (error: any) {
      console.error("Error resetting password:", error);
      toast.error(error.message || "Failed to reset password");
    } finally {
      setSubmitting(false);
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "owner":
        return "default";
      case "manager":
        return "secondary";
      default:
        return "outline";
    }
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base font-medium">Team Members</CardTitle>
          <CardDescription>{users.length} users in this tenant</CardDescription>
        </div>
        <Button size="sm" onClick={() => setAddDialogOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Add User
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  Loading users...
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No users in this tenant. Add users to get started.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.user_id}>
                  <TableCell className="font-medium">
                    {user.profile?.full_name || "Unknown User"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getRoleBadgeVariant(user.role)} className="capitalize">
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(user.created_at), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openChangeRoleDialog(user)}>
                          <Shield className="h-4 w-4 mr-2" />
                          Change Role
                        </DropdownMenuItem>
                        {user.role !== "owner" && (
                          <DropdownMenuItem onClick={() => handleGrantOwnership(user)}>
                            <Crown className="h-4 w-4 mr-2" />
                            Make Co-Owner
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => openResetPasswordDialog(user)}>
                          <KeyRound className="h-4 w-4 mr-2" />
                          Reset Password
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleRemoveUser(user)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Remove User
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      {/* Add User Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add User to Tenant</DialogTitle>
            <DialogDescription>
              Create a new user or add an existing user to this tenant. New users will need to reset their password on first login.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name (optional)</Label>
              <Input
                id="fullName"
                placeholder="John Doe"
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      <div className="flex flex-col">
                        <span>{role.label}</span>
                        <span className="text-xs text-muted-foreground">{role.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddUser} disabled={submitting}>
              {submitting ? "Creating..." : "Add User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Role Dialog */}
      <Dialog open={changeRoleDialogOpen} onOpenChange={setChangeRoleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change User Role</DialogTitle>
            <DialogDescription>
              Update the role for {selectedUser?.profile?.full_name || "this user"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="changeRole">New Role</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      <div className="flex flex-col">
                        <span>{role.label}</span>
                        <span className="text-xs text-muted-foreground">{role.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeRoleDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleChangeRole} disabled={submitting}>
              {submitting ? "Updating..." : "Update Role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset User Password</DialogTitle>
            <DialogDescription>
              Set a new password for {selectedUser?.profile?.full_name || "this user"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                placeholder="Enter new password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Password must be at least 6 characters
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPasswordDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleResetPassword} disabled={submitting}>
              {submitting ? "Resetting..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
