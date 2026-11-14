import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";
import { Monitor, Smartphone, Globe, LogOut, Shield, Clock, AlertTriangle } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface UserSession {
  id: string;
  user_id: string;
  ip_address: string | null;
  user_agent: string | null;
  device_info: Record<string, unknown>;
  last_active_at: string;
  created_at: string;
  is_active: boolean;
  profile?: {
    full_name: string | null;
  };
}

interface TenantSessionsManagerProps {
  tenantId: string;
}

export function TenantSessionsManager({ tenantId }: TenantSessionsManagerProps) {
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = async () => {
    try {
      const { data, error } = await db
        .from("user_sessions")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("last_active_at", { ascending: false });

      if (error) throw error;

      if (data && data.length > 0) {
        const userIds = [...new Set(data.map((s) => s.user_id))];
        const { data: profiles } = await db
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);

        const sessionsWithProfiles = data.map((session) => ({
          ...session,
          device_info: session.device_info as Record<string, unknown> || {},
          profile: profiles?.find((p) => p.id === session.user_id),
        }));
        setSessions(sessionsWithProfiles);
      } else {
        setSessions([]);
      }
    } catch (error) {
      console.error("Error fetching sessions:", error);
      toast.error("Failed to load sessions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [tenantId]);

  const handleRevokeSession = async (sessionId: string) => {
    try {
      const { error } = await db
        .from("user_sessions")
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
        })
        .eq("id", sessionId);

      if (error) throw error;
      toast.success("Session revoked successfully");
      fetchSessions();
    } catch (error) {
      console.error("Error revoking session:", error);
      toast.error("Failed to revoke session");
    }
  };

  const handleRevokeAllTenantSessions = async () => {
    try {
      const { error } = await db
        .from("user_sessions")
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("is_active", true);

      if (error) throw error;
      toast.success("All tenant sessions revoked");
      fetchSessions();
    } catch (error) {
      console.error("Error revoking sessions:", error);
      toast.error("Failed to revoke sessions");
    }
  };

  const getDeviceIcon = (userAgent: string | null) => {
    if (!userAgent) return <Globe className="h-4 w-4" />;
    const ua = userAgent.toLowerCase();
    if (ua.includes("mobile") || ua.includes("android") || ua.includes("iphone")) {
      return <Smartphone className="h-4 w-4" />;
    }
    return <Monitor className="h-4 w-4" />;
  };

  const parseDeviceInfo = (userAgent: string | null) => {
    if (!userAgent) return "Unknown device";
    if (userAgent.includes("Chrome")) return "Chrome";
    if (userAgent.includes("Firefox")) return "Firefox";
    if (userAgent.includes("Safari")) return "Safari";
    if (userAgent.includes("Edge")) return "Edge";
    return "Browser";
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Active Sessions
            </CardTitle>
            <CardDescription>
              {sessions.length} active session{sessions.length !== 1 && "s"} for this tenant
            </CardDescription>
          </div>
          {sessions.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Revoke All
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Revoke All Tenant Sessions</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will log out all users in this tenant from all devices. 
                    They will need to sign in again. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleRevokeAllTenantSessions}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Revoke All Sessions
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No active sessions
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Last Active</TableHead>
                <TableHead>Started</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="font-medium">
                    {session.profile?.full_name || "Unknown User"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getDeviceIcon(session.user_agent)}
                      <span className="text-sm">{parseDeviceInfo(session.user_agent)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {session.ip_address || "Unknown"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(session.last_active_at), { addSuffix: true })}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(session.created_at), "MMM d, HH:mm")}
                  </TableCell>
                  <TableCell>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <LogOut className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Revoke Session</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will log out {session.profile?.full_name || "the user"} from this device.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleRevokeSession(session.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Revoke
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}