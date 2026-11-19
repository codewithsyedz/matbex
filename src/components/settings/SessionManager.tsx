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
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Monitor, Smartphone, Globe, LogOut, Shield, Clock } from "lucide-react";
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

export function SessionManager() {
  const { user, tenant, isOwner } = useAuth();
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(true);
  
  const tenantId = tenant?.id;

  const fetchSessions = async () => {
    if (!tenantId) return;

    try {
      const { data, error } = await db
        .from("user_sessions")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("last_active_at", { ascending: false });

      if (error) throw error;

      // Fetch profiles for users
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

  const handleRevokeAllSessions = async (userId: string) => {
    try {
      const { error } = await db
        .from("user_sessions")
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .eq("is_active", true);

      if (error) throw error;
      toast.success("All sessions revoked for user");
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
    
    // Simple UA parsing
    if (userAgent.includes("Chrome")) return "Chrome Browser";
    if (userAgent.includes("Firefox")) return "Firefox Browser";
    if (userAgent.includes("Safari")) return "Safari Browser";
    if (userAgent.includes("Edge")) return "Edge Browser";
    return "Web Browser";
  };

  const isCurrentSession = (session: UserSession) => {
    return session.user_id === user?.id;
  };

  // Group sessions by user
  const sessionsByUser = sessions.reduce((acc, session) => {
    const userId = session.user_id;
    if (!acc[userId]) {
      acc[userId] = {
        profile: session.profile,
        sessions: [],
      };
    }
    acc[userId].sessions.push(session);
    return acc;
  }, {} as Record<string, { profile?: { full_name: string | null }; sessions: UserSession[] }>);

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Active Sessions
        </CardTitle>
        <CardDescription>
          View and manage active user sessions {isOwner && "across your organization"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No active sessions found
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(sessionsByUser).map(([userId, data]) => (
              <div key={userId} className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                      <span className="text-xs font-medium">
                        {data.profile?.full_name?.charAt(0) || "U"}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-sm">
                        {data.profile?.full_name || "Unknown User"}
                        {userId === user?.id && (
                          <Badge variant="secondary" className="ml-2 text-xs">
                            You
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {data.sessions.length} active session{data.sessions.length !== 1 && "s"}
                      </p>
                    </div>
                  </div>
                  {isOwner && userId !== user?.id && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-destructive">
                          Revoke All
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Revoke All Sessions</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will log out {data.profile?.full_name || "this user"} from all devices. 
                            They will need to sign in again.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleRevokeAllSessions(userId)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Revoke All
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Device</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Last Active</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.sessions.map((session) => (
                      <TableRow key={session.id}>
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
                          {(isOwner || isCurrentSession(session)) && (
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
                                    {isCurrentSession(session)
                                      ? "This will log you out of this device."
                                      : "This will log out the user from this device."}
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
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}