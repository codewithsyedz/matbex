import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/integrations/db/client";
import { AccountantPermissionsCard } from "@/components/team/AccountantPermissionsCard";
import { InvitationActivityDialog } from "@/components/team/InvitationActivityDialog";
import { useQuota } from "@/hooks/useQuota";
import { QuotaAlert, QuotaInfoCard } from "@/components/quota";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Plus, 
  MoreHorizontal, 
  Shield, 
  User, 
  Crown, 
  Loader2, 
  Mail, 
  Clock, 
  CheckCircle, 
  XCircle,
  RefreshCw,
  Trash2,
  Key,
  Eye,
  EyeOff,
  CircleDollarSign,
  AlertCircle,
  Copy,
  Check,
} from "lucide-react";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface TeamMember {
  id: string;
  user_id: string;
  role: "owner" | "manager" | "cashier" | "accountant";
  created_at: string;
  profile: {
    full_name: string | null;
  } | null;
  email?: string;
}

interface TeamInvitation {
  id: string;
  email: string;
  role: "owner" | "manager" | "cashier" | "accountant";
  status: "pending" | "accepted" | "expired" | "cancelled";
  invited_at: string;
  expires_at: string;
  accepted_at: string | null;
}

const inviteSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  role: z.enum(["manager", "cashier", "accountant"], {
    required_error: "Please select a role",
  }),
});

const roleConfig = {
  owner: {
    label: "Owner",
    icon: Crown,
    className: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    description: "Full access to all features",
  },
  manager: {
    label: "Manager",
    icon: Shield,
    className: "bg-primary/10 text-primary border-primary/20",
    description: "Can manage shifts, staff, and reports",
  },
  cashier: {
    label: "Cashier",
    icon: User,
    className: "bg-muted text-muted-foreground border-muted",
    description: "Can operate shifts and record transactions",
  },
  accountant: {
    label: "Accountant",
    icon: CircleDollarSign,
    className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    description: "Read access to accounting, reports, and finance",
  },
};

const statusConfig = {
  pending: {
    label: "Pending",
    icon: Clock,
    className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  },
  accepted: {
    label: "Accepted",
    icon: CheckCircle,
    className: "bg-green-500/10 text-green-600 border-green-500/20",
  },
  expired: {
    label: "Expired",
    icon: XCircle,
    className: "bg-muted text-muted-foreground border-muted",
  },
  cancelled: {
    label: "Cancelled",
    icon: XCircle,
    className: "bg-red-500/10 text-red-600 border-red-500/20",
  },
};

// Translate edge-function and network errors into user-facing messages, and
// classify each one as a field-level error (attached to the email input) or
// a form-level error (rendered as an inline alert in the dialog).
type InviteErrorField = "email" | "form";
interface FriendlyInviteError {
  field: InviteErrorField;
  message: string;
}
async function getFriendlyInviteError(error: any, email: string): Promise<FriendlyInviteError> {
  // db-js wraps non-2xx responses in FunctionsHttpError with a Response
  // in error.context. Extract the JSON body so we can read the real reason.
  let serverMessage: string | undefined;
  let status: number | undefined;
  try {
    const ctx = error?.context;
    if (ctx && typeof ctx.json === "function") {
      status = ctx.status;
      const body = await ctx.clone().json().catch(() => null);
      serverMessage = body?.error || body?.message;
    }
  } catch {
    // ignore body parse errors and fall back to error.message
  }
  const msg = (serverMessage || error?.message || "").toString();
  const lower = msg.toLowerCase();

  if (status === 401 || lower.includes("authentication") || lower.includes("invalid authentication") || lower.includes("unauthorized") || lower.includes("jwt")) {
    return { field: "form", message: "Your session has expired. Please sign out and sign back in, then try again." };
  }
  if (status === 403 || lower.includes("only") && (lower.includes("owner") || lower.includes("manager") || lower.includes("superadmin"))) {
    return { field: "form", message: "You don't have permission to invite this user. Only owners or managers can send invitations." };
  }
  if (lower.includes("already a member") || lower.includes("already exists") || lower.includes("already a team")) {
    return { field: "email", message: `${email} is already a member of this team.` };
  }
  if (lower.includes("pending") || lower.includes("already invited")) {
    return { field: "email", message: `${email} already has a pending invitation. Use "Resend" on the list below instead.` };
  }
  if (lower.includes("limit reached") || lower.includes("quota")) {
    return { field: "form", message: msg };
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("network error")) {
    return { field: "form", message: "Network error - please check your connection and try again." };
  }
  if (lower.includes("resend") || lower.includes("email") && lower.includes("send")) {
    return { field: "email", message: "We couldn't deliver the invitation email. Please verify the address and try again." };
  }
  return { field: "form", message: msg || "Failed to send invitation. Please try again." };
}

export default function Team() {
  const { t } = useTranslation();
  const { restaurant, isOwner, user, tenant, plan } = useAuth();
  const { checkQuota, isAtLimit, isNearLimit, usage, quotaLimits, refetchUsage } = useQuota();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"manager" | "cashier" | "accountant">("cashier");
  const [isInviting, setIsInviting] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; role?: string; form?: string }>({});
  const [pendingDuplicate, setPendingDuplicate] = useState<{ id: string; email: string; role: TeamInvitation["role"] } | null>(null);
  const [activityFor, setActivityFor] = useState<{ id: string; email: string } | null>(null);
  const [deleteInviteId, setDeleteInviteId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [ownerEmails, setOwnerEmails] = useState<string[]>([]);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const [showFallbackEmail, setShowFallbackEmail] = useState<string | null>(null);
  const [isRequestingSeats, setIsRequestingSeats] = useState(false);
  const [quotaErrorDetails, setQuotaErrorDetails] = useState<{
    quotaType: "users" | "manager" | "cashier";
    current: number;
    limit: number;
    role?: string;
  } | null>(null);
  const [seatRequestSent, setSeatRequestSent] = useState(false);
  const [copyCooldownRemaining, setCopyCooldownRemaining] = useState(0);
  const COPY_COOLDOWN_MS = 5000;
  
  // Password setting state
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [selectedMemberForPassword, setSelectedMemberForPassword] = useState<TeamMember | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSettingPassword, setIsSettingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Countdown timer for the copy-admin-email cooldown UI
  useEffect(() => {
    if (copyCooldownRemaining <= 0) return;
    const interval = setInterval(() => {
      setCopyCooldownRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [copyCooldownRemaining]);

  useEffect(() => {
    if (restaurant?.id) {
      fetchTeamMembers();
      fetchInvitations();
    }
  }, [restaurant?.id]);

  // Re-check quota counters when the user returns to the Team tab/window
  // (e.g. after upgrading on Billing in another tab) or refocuses the page,
  // so the invite form reflects fresh seat availability without a refresh.
  useEffect(() => {
    const handleRefresh = () => {
      if (!restaurant?.id) return;
      refetchUsage();
      fetchTeamMembers();
      fetchInvitations();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") handleRefresh();
    };
    window.addEventListener("focus", handleRefresh);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleRefresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [restaurant?.id, refetchUsage]);

  // Also re-check whenever the invite dialog is opened, so counters reflect
  // any seat changes that happened while the dialog was closed.
  useEffect(() => {
    if (inviteOpen && restaurant?.id) {
      refetchUsage();
    }
  }, [inviteOpen, restaurant?.id, refetchUsage]);

  const fetchTeamMembers = async () => {
    if (!restaurant?.id) return;

    try {
      const { data, error } = await db
        .from("user_roles")
        .select(`
          id,
          user_id,
          role,
          created_at
        `)
        .eq("restaurant_id", restaurant.id)
        .order("created_at", { ascending: true });

      if (error) throw error;

      // Fetch profiles for each user
      const membersWithProfiles = await Promise.all(
        (data || []).map(async (member) => {
          const { data: profileData } = await db
            .from("profiles")
            .select("full_name")
            .eq("id", member.user_id)
            .maybeSingle();

          return {
            ...member,
            profile: profileData,
          } as TeamMember;
        })
      );

      setMembers(membersWithProfiles);
    } catch (error) {
      console.error("Error fetching team members:", error);
      toast.error("Failed to load team members");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchInvitations = async () => {
    if (!restaurant?.id) return;

    try {
      const { data, error } = await db
        .from("team_invitations")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("invited_at", { ascending: false });

      if (error) throw error;

      // Check for expired invitations and update their status
      const now = new Date();
      const processedInvitations: TeamInvitation[] = (data || []).map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role as "owner" | "manager" | "cashier" | "accountant",
        status: (inv.status === "pending" && new Date(inv.expires_at) < now ? "expired" : inv.status) as TeamInvitation["status"],
        invited_at: inv.invited_at,
        expires_at: inv.expires_at,
        accepted_at: inv.accepted_at,
      }));

      setInvitations(processedInvitations);
    } catch (error) {
      console.error("Error fetching invitations:", error);
    }
  };

  const fetchOwnerEmails = async () => {
    if (!tenant?.id) return;
    try {
      const { data, error } = await (db as any).rpc("get_tenant_owner_emails", {
        p_tenant_id: tenant.id,
      });
      if (error) throw error;
      setOwnerEmails((data || []).map((row: any) => row.email).filter(Boolean));
    } catch (err) {
      console.error("Error fetching owner emails:", err);
      setOwnerEmails([]);
    }
  };

  const handleRequestMoreSeats = async () => {
    if (!tenant?.id || !quotaErrorDetails) return;
    setIsRequestingSeats(true);
    try {
      const { error } = await db.functions.invoke("send-seat-request", {
        body: {
          tenant_id: tenant.id,
          restaurant_id: restaurant?.id,
          restaurant_name: restaurant?.name,
          quota_type: quotaErrorDetails.quotaType,
          current_usage: quotaErrorDetails.current,
          quota_limit: quotaErrorDetails.limit,
          requested_role: quotaErrorDetails.role,
          requester_email: user?.email,
          requester_name: (user as any)?.user_metadata?.full_name || user?.email,
        },
      });
      if (error) throw error;
      setSeatRequestSent(true);
      toast.success("Request sent to your admin");
    } catch (err: any) {
      console.error("Error requesting more seats:", err);
      toast.error(err?.message || "Failed to send request");
    } finally {
      setIsRequestingSeats(false);
    }
  };

  useEffect(() => {
    if (tenant?.id && !isOwner) {
      fetchOwnerEmails();
    }
  }, [tenant?.id, isOwner]);

  const handleInvite = async () => {
    setErrors({});
    setPendingDuplicate(null);
    setQuotaErrorDetails(null);
    setSeatRequestSent(false);
    
    const result = inviteSchema.safeParse({ email: inviteEmail, role: inviteRole });
    if (!result.success) {
      const fieldErrors: { email?: string; role?: string } = {};
      result.error.errors.forEach((err) => {
        if (err.path[0] === "email") fieldErrors.email = err.message;
        if (err.path[0] === "role") fieldErrors.role = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    if (!restaurant?.id || !user) return;

    setIsInviting(true);
    try {
      // Check total users (team-seat) quota first
      const totalQuota = await checkQuota("users");
      if (!totalQuota.allowed) {
        const planName = (plan as any)?.name
          ? `${(plan as any).name.charAt(0).toUpperCase()}${(plan as any).name.slice(1)}`
          : "your current";
        setQuotaErrorDetails({
          quotaType: "users",
          current: totalQuota.current ?? 0,
          limit: totalQuota.limit ?? 0,
          role: inviteRole,
        });
        setErrors({
          form:
            `Team-seat limit reached for the ${planName} plan ` +
            `(${totalQuota.current} of ${totalQuota.limit} seats used). ` +
            `To invite ${inviteEmail || "someone new"}, you can: ` +
            `1) remove an existing member from the Members tab to free a seat, ` +
            `2) wait and invite them later after freeing a seat, or ` +
            `3) upgrade your plan from Billing. ` +
            `If you're not the owner, please contact your account admin.`,
        });
        setIsInviting(false);
        return;
      }

      // Check role-specific quota (skip for accountant - no per-role quota defined)
      if (inviteRole !== "accountant") {
        const roleQuota = await checkQuota(inviteRole as "manager" | "cashier");
        if (!roleQuota.allowed) {
          const roleLabel = inviteRole.charAt(0).toUpperCase() + inviteRole.slice(1);
          setQuotaErrorDetails({
            quotaType: inviteRole as "manager" | "cashier",
            current: roleQuota.current ?? 0,
            limit: roleQuota.limit ?? 0,
            role: inviteRole,
          });
          setErrors({
            form:
              `${roleLabel} role limit reached ` +
              `(${roleQuota.current} of ${roleQuota.limit} ${inviteRole}s used on this plan). ` +
              `You still have overall team seats available, but no more ${inviteRole} slots. ` +
              `To proceed, you can: ` +
              `1) remove or change the role of an existing ${inviteRole} in the Members tab, ` +
              `2) invite this person as a different role for now, or ` +
              `3) upgrade your plan from Billing to unlock more ${inviteRole} slots. ` +
              `If you're not the owner, please contact your account admin.`,
          });
          setIsInviting(false);
          return;
        }
      }

      // Pre-check: is this email already a pending invite for this restaurant?
      const { data: pendingDup } = await db
        .from("team_invitations")
        .select("id, email, role")
        .eq("restaurant_id", restaurant.id)
        .eq("email", inviteEmail.toLowerCase())
        .eq("status", "pending")
        .maybeSingle();

      if (pendingDup) {
        setPendingDuplicate({
          id: pendingDup.id,
          email: pendingDup.email,
          role: pendingDup.role as TeamInvitation["role"],
        });
        setIsInviting(false);
        return;
      }

      const { data, error } = await db.functions.invoke("send-invite", {
        body: {
          email: inviteEmail,
          role: inviteRole,
          restaurant_id: restaurant.id,
          restaurant_name: restaurant.name,
          tenant_id: tenant?.id,
          invited_by: user.email || "Team Owner",
          invited_by_user_id: user.id,
        },
      });

      if (error) throw error;

      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("cashier");
      fetchInvitations();
      // send-invite creates the account and its role right away: the member list changes too.
      fetchTeamMembers();
    } catch (error: any) {
      console.error("Error inviting team member:", error);
      const friendly = await getFriendlyInviteError(error, inviteEmail);
      setErrors({ [friendly.field]: friendly.message });
    } finally {
      setIsInviting(false);
    }
  };

  const handleResendInvite = async (invitation: TeamInvitation) => {
    if (!restaurant?.id || !user) return;

    setResendingId(invitation.id);
    try {
      const { error } = await db.functions.invoke("send-invite", {
        body: {
          email: invitation.email,
          role: invitation.role,
          restaurant_id: restaurant.id,
          restaurant_name: restaurant.name,
          tenant_id: tenant?.id,
          invited_by: user.email || "Team Owner",
          invited_by_user_id: user.id,
        },
      });

      if (error) throw error;

      toast.success(`Invitation resent to ${invitation.email}`);
      fetchInvitations();
    } catch (error: any) {
      console.error("Error resending invitation:", error);
      const friendly = await getFriendlyInviteError(error, invitation.email);
      toast.error(friendly.message);
    } finally {
      setResendingId(null);
    }
  };

  const handleResendFromPrompt = async () => {
    if (!pendingDuplicate) return;
    await handleResendInvite({
      id: pendingDuplicate.id,
      email: pendingDuplicate.email,
      role: pendingDuplicate.role,
      status: "pending",
      invited_at: new Date().toISOString(),
      expires_at: new Date().toISOString(),
      accepted_at: null,
    });
    setPendingDuplicate(null);
    setInviteOpen(false);
    setInviteEmail("");
    setInviteRole("cashier");
  };

  const handleCancelInvite = async (invitationId: string) => {
    try {
      const { error } = await db
        .from("team_invitations")
        .update({ status: "cancelled" })
        .eq("id", invitationId);

      if (error) throw error;

      // Best-effort: write an audit-log entry for the cancellation.
      const invitation = invitations.find((i) => i.id === invitationId);
      if (invitation && restaurant?.id && tenant?.id) {
        await (db as any).from("team_invitation_events").insert({
          invitation_id: invitationId,
          restaurant_id: restaurant.id,
          tenant_id: tenant.id,
          email: invitation.email,
          event_type: "cancelled",
          actor_user_id: user?.id ?? null,
          actor_email: user?.email ?? null,
          message: `Invitation cancelled by ${user?.email ?? "a team owner"}`,
        });
      }

      toast.success("Invitation cancelled");
      fetchInvitations();
    } catch (error) {
      console.error("Error cancelling invitation:", error);
      toast.error("Failed to cancel invitation");
    }
  };

  const handleDeleteInvite = async () => {
    if (!deleteInviteId) return;

    try {
      const { error } = await db
        .from("team_invitations")
        .delete()
        .eq("id", deleteInviteId);

      if (error) throw error;

      toast.success("Invitation deleted");
      setDeleteInviteId(null);
      fetchInvitations();
    } catch (error) {
      console.error("Error deleting invitation:", error);
      toast.error("Failed to delete invitation");
    }
  };

  const handleRoleChange = async (memberId: string, newRole: "manager" | "cashier" | "accountant") => {
    if (!isOwner) {
      toast.error("Only owners can change roles");
      return;
    }

    try {
      const { error } = await db
        .from("user_roles")
        .update({ role: newRole })
        .eq("id", memberId);

      if (error) throw error;

      toast.success("Role updated successfully");
      fetchTeamMembers();
    } catch (error) {
      console.error("Error updating role:", error);
      toast.error("Failed to update role");
    }
  };

  const handleGrantOwnership = async (member: TeamMember) => {
    if (!isOwner) {
      toast.error("Only owners can transfer ownership");
      return;
    }
    if (!tenant?.id) {
      toast.error("Missing tenant context");
      return;
    }
    if (member.role === "owner") {
      toast.info("This member is already an owner");
      return;
    }
    const name = member.profile?.full_name || "this member";
    if (!confirm(`Grant ownership to ${name}? They will become a co-owner alongside you. This cannot be undone from here.`)) {
      return;
    }
    try {
      const { data, error } = await (db as any).rpc("grant_tenant_ownership", {
        _tenant_id: tenant.id,
        _target_user_id: member.user_id,
      });
      if (error) throw error;
      toast.success(`${name} is now a co-owner`);
      fetchTeamMembers();
    } catch (error: any) {
      console.error("Error granting ownership:", error);
      toast.error(error?.message || "Failed to grant ownership");
    }
  };

  const handleRevokeOwnership = async (
    member: TeamMember,
    newRole: "manager" | "cashier" | "accountant" = "manager",
  ) => {
    if (!isOwner) {
      toast.error("Only owners can change ownership");
      return;
    }
    if (!tenant?.id) {
      toast.error("Missing tenant context");
      return;
    }
    if (member.user_id === user?.id) {
      toast.error("You cannot revoke your own ownership. Ask another owner.");
      return;
    }
    const name = member.profile?.full_name || "this member";
    if (!confirm(`Revoke ownership from ${name} and set them as ${newRole}?`)) {
      return;
    }
    try {
      const { error } = await (db as any).rpc("revoke_tenant_ownership", {
        _tenant_id: tenant.id,
        _target_user_id: member.user_id,
        _new_role: newRole,
      });
      if (error) throw error;
      toast.success(`${name} is now ${newRole}`);
      fetchTeamMembers();
    } catch (error: any) {
      console.error("Error revoking ownership:", error);
      toast.error(error?.message || "Failed to revoke ownership");
    }
  };

  const handleRemoveMember = async (memberId: string, userId: string) => {
    if (!isOwner) {
      toast.error("Only owners can remove team members");
      return;
    }

    if (userId === user?.id) {
      toast.error("You cannot remove yourself");
      return;
    }

    try {
      if (!restaurant?.id || !tenant?.id) {
        throw new Error("Missing restaurant or tenant context");
      }

      // Atomic removal of both restaurant + tenant roles via RPC, so the
      // seat quota counter can't drift out of sync.
      const { data, error } = await (db as any).rpc("remove_team_member", {
        p_user_role_id: memberId,
        p_user_id: userId,
        p_restaurant_id: restaurant.id,
        p_tenant_id: tenant.id,
      });
      if (error) throw error;

      toast.success("Team member removed");
      fetchTeamMembers();

      // Re-check tenant quota so the UI shows the updated seat count immediately
      const { data: freshUsage } = await refetchUsage();
      const userLimit = quotaLimits?.users ?? null;
      const currentCount =
        (data as any)?.user_count ?? freshUsage?.user_count;
      if (userLimit != null && typeof currentCount === "number") {
        const remaining = Math.max(0, userLimit - currentCount);
        toast.info(`${remaining} seat${remaining === 1 ? "" : "s"} remaining`);
      }
    } catch (error: any) {
      console.error("Error removing member:", error);
      toast.error(error?.message || "Failed to remove team member");
    }
  };

  const handleOpenPasswordDialog = (member: TeamMember) => {
    setSelectedMemberForPassword(member);
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError(null);
    setPasswordDialogOpen(true);
  };

  const handleSetPassword = async () => {
    if (!selectedMemberForPassword || !restaurant?.id) return;
    
    setPasswordError(null);
    
    if (newPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters");
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }

    setIsSettingPassword(true);
    try {
      const { data, error } = await db.functions.invoke("set-team-password", {
        body: {
          user_id: selectedMemberForPassword.user_id,
          new_password: newPassword,
          restaurant_id: restaurant.id,
        },
      });

      if (error) throw error;

      toast.success(`Password updated for ${selectedMemberForPassword.profile?.full_name || "team member"}`);
      setPasswordDialogOpen(false);
      setSelectedMemberForPassword(null);
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: any) {
      console.error("Error setting password:", error);
      setPasswordError(error.message || "Failed to set password");
    } finally {
      setIsSettingPassword(false);
    }
  };

  const pendingInvitations = invitations.filter((i) => i.status === "pending");
  const otherInvitations = invitations.filter((i) => i.status !== "pending");

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 fade-slide-in mb-6 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
              {t("team.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("team.subtitle")}
            </p>
          </div>
          {isOwner && (
            <>
              <QuotaAlert quotaType="users" />
              <Dialog open={inviteOpen} onOpenChange={(open) => {
                setInviteOpen(open);
                if (!open) {
                  setErrors({});
                  setPendingDuplicate(null);
                }
              }}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5" disabled={isAtLimit("users")}>
                    <Plus className="h-4 w-4" />
                    <span className="hidden sm:inline">{t("team.inviteMember")}</span>
                  </Button>
                </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("team.inviteDialogTitle")}</DialogTitle>
                  <DialogDescription>
                    {t("team.inviteDialogDesc")}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  {pendingDuplicate && (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription className="space-y-3">
                        <p>
                          <span className="font-medium text-foreground">{pendingDuplicate.email}</span> already has a pending invitation as <span className="font-medium text-foreground">{pendingDuplicate.role}</span>. Resend the email instead of creating a new one?
                        </p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={handleResendFromPrompt}
                            disabled={resendingId === pendingDuplicate.id}
                          >
                            {resendingId === pendingDuplicate.id ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                            )}
                            Resend invitation
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setPendingDuplicate(null)}
                            disabled={resendingId === pendingDuplicate.id}
                          >
                            Use a different email
                          </Button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}
                  {errors.form && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription className="space-y-2">
                        <p>{errors.form}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={handleInvite}
                            disabled={isInviting}
                          >
                            {isInviting ? (
                              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5 mr-2" />
                            )}
                            Try again
                          </Button>
                          {!isOwner && ownerEmails.length > 0 && (
                            <div className="flex items-center gap-1.5">
                              {quotaErrorDetails && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="default"
                                  className="text-xs"
                                  onClick={handleRequestMoreSeats}
                                  disabled={isRequestingSeats || seatRequestSent}
                                >
                                  {isRequestingSeats ? (
                                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                  ) : seatRequestSent ? (
                                    <Check className="h-3.5 w-3.5 mr-1.5" />
                                  ) : (
                                    <Mail className="h-3.5 w-3.5 mr-1.5" />
                                  )}
                                  {seatRequestSent ? "Request sent" : "Request more seats"}
                                </Button>
                              )}
                              {ownerEmails.map((email) => (
                                <React.Fragment key={email}>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className={cn(
                                      "text-xs",
                                      (copyCooldownRemaining > 0 || copiedEmail === email) && "opacity-50 cursor-not-allowed"
                                    )}
                                    aria-live="polite"
                                    aria-label={
                                      copiedEmail === email
                                        ? "Copied admin email"
                                        : copyCooldownRemaining > 0
                                          ? `Wait ${copyCooldownRemaining} seconds before copying admin email again`
                                          : `Copy admin email ${email}`
                                    }
                                    aria-disabled={copyCooldownRemaining > 0 || copiedEmail === email}
                                    onClick={async () => {
                                      if (copyCooldownRemaining > 0 || copiedEmail === email) return;
                                      try {
                                        await navigator.clipboard.writeText(email);
                                        setCopiedEmail(email);
                                        toast.success(`Copied ${email} to clipboard`);
                                        setTimeout(() => setCopiedEmail((prev) => (prev === email ? null : prev)), 3000);
                                      } catch {
                                        setShowFallbackEmail(email);
                                      }
                                      // Lightweight audit log so admins can track quota friction
                                      // Rate-limited: one log entry per user per 5 seconds
                                      if (copyCooldownRemaining <= 0) {
                                        setCopyCooldownRemaining(Math.ceil(COPY_COOLDOWN_MS / 1000));
                                        try {
                                          // Server-side rate limit also enforces a cooldown so the
                                          // log can't be flooded even if the client check is bypassed.
                                          await db.rpc("log_audit_event_rate_limited", {
                                            _action: "quota_admin_email_copied",
                                            _entity_type: "team_quota",
                                            _new_data: {
                                              copied_email: email,
                                              restaurant_id: restaurant?.id ?? null,
                                              restaurant_name: restaurant?.name ?? null,
                                              quota_type: quotaErrorDetails?.quotaType ?? null,
                                              current_usage: quotaErrorDetails?.current ?? null,
                                              quota_limit: quotaErrorDetails?.limit ?? null,
                                              requested_role: quotaErrorDetails?.role ?? inviteRole,
                                              requester_email: user?.email ?? null,
                                            },
                                            _cooldown_seconds: 5,
                                          });
                                        } catch (auditErr) {
                                          console.warn("Failed to log copy-admin-email audit event", auditErr);
                                        }
                                      }
                                    }}
                                  >
                                    {copiedEmail === email ? (
                                      <Check className="h-3.5 w-3.5 mr-1.5" />
                                    ) : copyCooldownRemaining > 0 ? (
                                      <Clock className="h-3.5 w-3.5 mr-1.5 animate-pulse" />
                                    ) : (
                                      <Copy className="h-3.5 w-3.5 mr-1.5" />
                                    )}
                                    <span aria-hidden="true">
                                      {copiedEmail === email
                                        ? "Copied"
                                        : copyCooldownRemaining > 0
                                          ? `Wait ${copyCooldownRemaining}s…`
                                          : "Copy admin email"}
                                    </span>
                                  </Button>
                                </React.Fragment>
                              ))}
                            </div>
                          )}
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}
                  {/* Seat Availability Counters */}
                  {usage && Object.keys(quotaLimits).length > 0 && (
                    <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Seat Availability</span>
                        <span className="text-xs text-muted-foreground">
                          {Math.max(0, (quotaLimits.users ?? 0) - (usage.user_count ?? 0))} team seat{Math.max(0, (quotaLimits.users ?? 0) - (usage.user_count ?? 0)) === 1 ? "" : "s"} remaining
                        </span>
                      </div>

                      {/* Total team seats */}
                      {quotaLimits.users !== undefined && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Team Members</span>
                            <span className={usage.user_count >= quotaLimits.users ? "text-destructive font-medium" : ""}>
                              {usage.user_count} / {quotaLimits.users}
                            </span>
                          </div>
                          <Progress
                            value={Math.min(100, Math.round(((usage.user_count ?? 0) / quotaLimits.users) * 100))}
                            className={`h-1.5 ${usage.user_count >= quotaLimits.users ? "[&>div]:bg-destructive" : ""}`}
                          />
                        </div>
                      )}

                      {/* Manager slots */}
                      {quotaLimits.manager !== undefined && (
                        <div className={`space-y-1 rounded p-1.5 -m-1.5 ${inviteRole === "manager" ? "bg-primary/5 border border-primary/10" : ""}`}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground flex items-center gap-1">
                              <Shield className="h-3 w-3" />
                              Managers
                              {inviteRole === "manager" && (
                                <Badge variant="outline" className="text-[10px] h-4 px-1 py-0 ml-1">selected</Badge>
                              )}
                            </span>
                            <span className={usage.manager_count >= quotaLimits.manager ? "text-destructive font-medium" : ""}>
                              {usage.manager_count} / {quotaLimits.manager}
                            </span>
                          </div>
                          <Progress
                            value={Math.min(100, Math.round(((usage.manager_count ?? 0) / quotaLimits.manager) * 100))}
                            className={`h-1.5 ${usage.manager_count >= quotaLimits.manager ? "[&>div]:bg-destructive" : inviteRole === "manager" ? "[&>div]:bg-primary" : ""}`}
                          />
                        </div>
                      )}

                      {/* Cashier slots */}
                      {quotaLimits.cashier !== undefined && (
                        <div className={`space-y-1 rounded p-1.5 -m-1.5 ${inviteRole === "cashier" ? "bg-primary/5 border border-primary/10" : ""}`}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground flex items-center gap-1">
                              <User className="h-3 w-3" />
                              Cashiers
                              {inviteRole === "cashier" && (
                                <Badge variant="outline" className="text-[10px] h-4 px-1 py-0 ml-1">selected</Badge>
                              )}
                            </span>
                            <span className={usage.cashier_count >= quotaLimits.cashier ? "text-destructive font-medium" : ""}>
                              {usage.cashier_count} / {quotaLimits.cashier}
                            </span>
                          </div>
                          <Progress
                            value={Math.min(100, Math.round(((usage.cashier_count ?? 0) / quotaLimits.cashier) * 100))}
                            className={`h-1.5 ${usage.cashier_count >= quotaLimits.cashier ? "[&>div]:bg-destructive" : inviteRole === "cashier" ? "[&>div]:bg-primary" : ""}`}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="colleague@example.com"
                      value={inviteEmail}
                      onChange={(e) => {
                        setInviteEmail(e.target.value);
                        if (errors.email || errors.form) setErrors({});
                        if (pendingDuplicate) setPendingDuplicate(null);
                      }}
                      aria-invalid={!!errors.email}
                      aria-describedby={errors.email ? "email-error" : undefined}
                      className={errors.email ? "border-destructive focus-visible:ring-destructive" : undefined}
                    />
                    {errors.email && (
                      <p id="email-error" className="text-sm text-destructive flex items-start gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>{errors.email}</span>
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select value={inviteRole} onValueChange={(v) => {
                      setInviteRole(v as "manager" | "cashier" | "accountant");
                      if (errors.role || errors.form) setErrors((prev) => ({ ...prev, role: undefined, form: undefined }));
                    }}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manager">
                          <div className="flex items-center gap-2">
                            <Shield className="h-4 w-4" />
                            <div>
                              <span>Manager</span>
                              <p className="text-xs text-muted-foreground">
                                {roleConfig.manager.description}
                              </p>
                            </div>
                          </div>
                        </SelectItem>
                        <SelectItem value="cashier">
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4" />
                            <div>
                              <span>Cashier</span>
                              <p className="text-xs text-muted-foreground">
                                {roleConfig.cashier.description}
                              </p>
                            </div>
                          </div>
                        </SelectItem>
                        <SelectItem value="accountant">
                          <div className="flex items-center gap-2">
                            <CircleDollarSign className="h-4 w-4" />
                            <div>
                              <span>Accountant</span>
                              <p className="text-xs text-muted-foreground">
                                {roleConfig.accountant.description}
                              </p>
                            </div>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {errors.role && (
                      <p className="text-sm text-destructive">{errors.role}</p>
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setInviteOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleInvite} disabled={isInviting}>
                    {isInviting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Send Invite
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </>
          )}
        </header>

        {/* Role Legend */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 fade-slide-in" style={{ animationDelay: "50ms" }}>
          {Object.entries(roleConfig).map(([key, config]) => {
            const Icon = config.icon;
            return (
              <div key={key} className="p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-md ${config.className}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-medium text-sm">{config.label}</h3>
                    <p className="text-xs text-muted-foreground">{config.description}</p>
                  </div>
                </div>
              </div>
          );
        })}
      </div>

      {/* Permissions Matrix */}
      <div className="rounded-lg border bg-card p-5 fade-slide-in" style={{ animationDelay: "75ms" }}>
        <h3 className="text-sm font-semibold mb-4">Permissions Overview</h3>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[200px]">Feature</TableHead>
                <TableHead className="text-center">
                  <div className="flex flex-col items-center gap-1">
                    <Crown className="h-4 w-4 text-amber-600" />
                    <span className="text-xs">Owner</span>
                  </div>
                </TableHead>
                <TableHead className="text-center">
                  <div className="flex flex-col items-center gap-1">
                    <Shield className="h-4 w-4 text-primary" />
                    <span className="text-xs">Manager</span>
                  </div>
                </TableHead>
                <TableHead className="text-center">
                  <div className="flex flex-col items-center gap-1">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs">Cashier</span>
                  </div>
                </TableHead>
                <TableHead className="text-center">
                  <div className="flex flex-col items-center gap-1">
                    <CircleDollarSign className="h-4 w-4 text-emerald-600" />
                    <span className="text-xs">Accountant</span>
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium text-sm">Dashboard & KPIs</TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">View & Edit</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">View & Edit</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs">View Only</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs">View Only</Badge></TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-sm">POS / Shifts / Sales</TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">View & Edit</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">View & Edit</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">View & Edit</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20 text-xs">No Access</Badge></TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-sm">Inventory & Stock</TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">View & Edit</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">View & Edit</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20 text-xs">No Access</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20 text-xs">No Access</Badge></TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-sm">Accounting & Ledger</TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">View & Edit</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">View & Edit</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20 text-xs">No Access</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs">View Only</Badge></TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-sm">COGS & Expenses</TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">View & Edit</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">View & Edit</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20 text-xs">No Access</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs">View Only</Badge></TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-sm">Reports & P&L</TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">View & Edit</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">View & Edit</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs">View Only</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs">View Only</Badge></TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-sm">Team Management</TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">View & Edit</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs">View Only</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20 text-xs">No Access</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20 text-xs">No Access</Badge></TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-sm">Settings & Billing</TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">View & Edit</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs">View Only</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20 text-xs">No Access</Badge></TableCell>
                <TableCell className="text-center"><Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs">View Only</Badge></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Accountants have read-only access to all finance and accounting data. They cannot create or edit transactions, journal entries, or expenses.
          <span className="block mt-1">
            Owners can grant accountants limited write access to journal entries below.
          </span>
        </p>
      </div>

      {/* Owner-only: grant accountants journal-posting access */}
      <AccountantPermissionsCard />

      {/* Seat Usage Card */}
      {isOwner && (
        <div className="fade-slide-in" style={{ animationDelay: "50ms" }}>
          <QuotaInfoCard quotaType="users" label="Team Seats" />
        </div>
      )}

      {/* Tabs for Members and Invitations */}
      <Tabs defaultValue="members" className="mt-6 fade-slide-in" style={{ animationDelay: "100ms" }}>
          <TabsList>
            <TabsTrigger value="members" className="gap-2">
              <User className="h-4 w-4" />
              Members
              {members.length > 0 && (
                <Badge variant="secondary" className="ml-1">{members.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="invitations" className="gap-2">
              <Mail className="h-4 w-4" />
              Invitations
              {pendingInvitations.length > 0 && (
                <Badge variant="secondary" className="ml-1 bg-yellow-500/20 text-yellow-600">
                  {pendingInvitations.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Members Tab */}
          <TabsContent value="members" className="mt-4">
            <div className="rounded-lg border bg-card">
              {isLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : members.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center">
                  <User className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No team members yet</p>
                  <p className="text-sm text-muted-foreground">Invite your first team member to get started</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Joined</TableHead>
                      {isOwner && <TableHead className="w-10"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((member) => {
                      const config = roleConfig[member.role];
                      const Icon = config.icon;
                      const isCurrentUser = member.user_id === user?.id;

                      return (
                        <TableRow key={member.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center">
                                <User className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div>
                                <p className="font-medium">
                                  {member.profile?.full_name || "Unknown"}
                                  {isCurrentUser && (
                                    <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                                  )}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={config.className}>
                              <Icon className="h-3 w-3 mr-1" />
                              {config.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(member.created_at).toLocaleDateString()}
                          </TableCell>
                          {isOwner && (
                            <TableCell>
              {(member.role !== "owner" || member.user_id !== user?.id) && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                    {member.role === "owner" ? (
                      <>
                        <DropdownMenuItem onClick={() => handleRevokeOwnership(member, "manager")}>
                          <Shield className="h-4 w-4 mr-2" />
                          Revoke ownership → Manager
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleRevokeOwnership(member, "cashier")}>
                          <User className="h-4 w-4 mr-2" />
                          Revoke ownership → Cashier
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleRevokeOwnership(member, "accountant")}>
                          <CircleDollarSign className="h-4 w-4 mr-2" />
                          Revoke ownership → Accountant
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    ) : (
                      <>
                    {member.role !== "manager" && (
                                      <DropdownMenuItem onClick={() => handleRoleChange(member.id, "manager")}>
                                        <Shield className="h-4 w-4 mr-2" />
                                        Make Manager
                                      </DropdownMenuItem>
                                    )}
                                    {member.role !== "cashier" && (
                                      <DropdownMenuItem onClick={() => handleRoleChange(member.id, "cashier")}>
                                        <User className="h-4 w-4 mr-2" />
                                        Make Cashier
                                      </DropdownMenuItem>
                                    )}
                                    {member.role !== "accountant" && (
                                      <DropdownMenuItem onClick={() => handleRoleChange(member.id, "accountant")}>
                                        <CircleDollarSign className="h-4 w-4 mr-2" />
                                        Make Accountant
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => handleGrantOwnership(member)}>
                                      <Crown className="h-4 w-4 mr-2" />
                                      Make Co-Owner
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                      </>
                    )}
                                    <DropdownMenuItem onClick={() => handleOpenPasswordDialog(member)}>
                                      <Key className="h-4 w-4 mr-2" />
                                      Set Password
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-destructive"
                                      onClick={() => handleRemoveMember(member.id, member.user_id)}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Remove from Team
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>

          {/* Invitations Tab */}
          <TabsContent value="invitations" className="mt-4">
            <div className="rounded-lg border bg-card">
              {invitations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center">
                  <Mail className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No invitations sent yet</p>
                  <p className="text-sm text-muted-foreground">Invite team members to see them here</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Sent</TableHead>
                      {isOwner && <TableHead className="w-10"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invitations.map((invitation) => {
                      const roleConf = roleConfig[invitation.role];
                      const RoleIcon = roleConf.icon;
                      const statusConf = statusConfig[invitation.status];
                      const StatusIcon = statusConf.icon;
                      const isExpired = invitation.status === "pending" && new Date(invitation.expires_at) < new Date();
                      const displayStatus = isExpired ? "expired" : invitation.status;
                      const displayStatusConf = statusConfig[displayStatus];
                      const DisplayStatusIcon = displayStatusConf.icon;

                      return (
                        <TableRow key={invitation.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center">
                                <Mail className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <span className="font-medium">{invitation.email}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={roleConf.className}>
                              <RoleIcon className="h-3 w-3 mr-1" />
                              {roleConf.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={displayStatusConf.className}>
                              <DisplayStatusIcon className="h-3 w-3 mr-1" />
                              {displayStatusConf.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {formatDistanceToNow(new Date(invitation.invited_at), { addSuffix: true })}
                          </TableCell>
                          {isOwner && (
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {(displayStatus === "pending" || displayStatus === "expired") && (
                                    <DropdownMenuItem 
                                      onClick={() => handleResendInvite(invitation)}
                                      disabled={resendingId === invitation.id}
                                    >
                                      {resendingId === invitation.id ? (
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                      ) : (
                                        <RefreshCw className="h-4 w-4 mr-2" />
                                      )}
                                      Resend Invite
                                    </DropdownMenuItem>
                                  )}
                                  {displayStatus === "pending" && (
                                    <DropdownMenuItem onClick={() => handleCancelInvite(invitation.id)}>
                                      <XCircle className="h-4 w-4 mr-2" />
                                      Cancel Invite
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setActivityFor({ id: invitation.id, email: invitation.email })
                                    }
                                  >
                                    <Clock className="h-4 w-4 mr-2" />
                                    View activity
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => setDeleteInviteId(invitation.id)}
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <InvitationActivityDialog
          invitationId={activityFor?.id ?? null}
          email={activityFor?.email}
          onClose={() => setActivityFor(null)}
        />

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!deleteInviteId} onOpenChange={() => setDeleteInviteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Invitation</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this invitation? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteInvite} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Set Password Dialog */}
        <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Set Password</DialogTitle>
              <DialogDescription>
                Set a new password for {selectedMemberForPassword?.profile?.full_name || "team member"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {passwordError && (
                <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  {passwordError}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    type={showNewPassword ? "text" : "password"}
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPasswordDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSetPassword} disabled={isSettingPassword}>
                {isSettingPassword && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Set Password
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Clipboard fallback modal */}
        <Dialog open={!!showFallbackEmail} onOpenChange={(open) => { if (!open) setShowFallbackEmail(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Copy Admin Email</DialogTitle>
              <DialogDescription>
                Clipboard access was blocked. Copy the email manually below.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={showFallbackEmail ?? ""}
                  className="flex-1"
                  onFocus={(e) => e.target.select()}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (showFallbackEmail) {
                      try {
                        navigator.clipboard.writeText(showFallbackEmail);
                        setCopiedEmail(showFallbackEmail);
                        toast.success("Copied to clipboard");
                        setTimeout(() => setShowFallbackEmail(null), 500);
                      } catch {
                        toast.error("Still unable to copy. Please select and copy manually.");
                      }
                    }
                  }}
                >
                  <Copy className="h-3.5 w-3.5 mr-1.5" />
                  Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Tip: Click the input field above to select the email, then press Ctrl+C (or Cmd+C) to copy.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowFallbackEmail(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
