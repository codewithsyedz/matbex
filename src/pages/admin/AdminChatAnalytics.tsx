import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, MessageSquare, Users, TrendingUp, Building2, Hash, MessagesSquare } from "lucide-react";
import { useState } from "react";
import { format, subDays, startOfDay } from "date-fns";

interface TenantStats {
  tenantId: string;
  tenantName: string;
  totalMessages: number;
  activeUsers: number;
  channelCount: number;
  conversationCount: number;
  messagesLast7Days: number;
  messagesLast30Days: number;
}

interface PlatformStats {
  totalMessages: number;
  totalActiveUsers: number;
  totalChannels: number;
  totalConversations: number;
  messagesLast7Days: number;
  messagesLast30Days: number;
}

export default function AdminChatAnalytics() {
  const [timeRange, setTimeRange] = useState<string>("30");

  // Fetch platform-wide stats
  const { data: platformStats, isLoading: platformLoading } = useQuery({
    queryKey: ["chat-platform-stats"],
    queryFn: async () => {
      const now = new Date();
      const sevenDaysAgo = startOfDay(subDays(now, 7)).toISOString();
      const thirtyDaysAgo = startOfDay(subDays(now, 30)).toISOString();

      // Total messages
      const { count: totalMessages } = await supabase
        .from("chat_messages")
        .select("*", { count: "exact", head: true });

      // Messages last 7 days
      const { count: messagesLast7Days } = await supabase
        .from("chat_messages")
        .select("*", { count: "exact", head: true })
        .gte("created_at", sevenDaysAgo);

      // Messages last 30 days
      const { count: messagesLast30Days } = await supabase
        .from("chat_messages")
        .select("*", { count: "exact", head: true })
        .gte("created_at", thirtyDaysAgo);

      // Total channels
      const { count: totalChannels } = await supabase
        .from("chat_channels")
        .select("*", { count: "exact", head: true });

      // Total conversations
      const { count: totalConversations } = await supabase
        .from("chat_conversations")
        .select("*", { count: "exact", head: true });

      // Active users (distinct senders in last 30 days)
      const { data: activeUsersData } = await supabase
        .from("chat_messages")
        .select("sender_id")
        .gte("created_at", thirtyDaysAgo);
      
      const uniqueSenders = new Set(activeUsersData?.map(m => m.sender_id) || []);

      return {
        totalMessages: totalMessages || 0,
        totalActiveUsers: uniqueSenders.size,
        totalChannels: totalChannels || 0,
        totalConversations: totalConversations || 0,
        messagesLast7Days: messagesLast7Days || 0,
        messagesLast30Days: messagesLast30Days || 0,
      } as PlatformStats;
    },
  });

  // Fetch per-tenant stats
  const { data: tenantStats = [], isLoading: tenantsLoading } = useQuery({
    queryKey: ["chat-tenant-stats"],
    queryFn: async () => {
      const now = new Date();
      const sevenDaysAgo = startOfDay(subDays(now, 7)).toISOString();
      const thirtyDaysAgo = startOfDay(subDays(now, 30)).toISOString();

      // Get all tenants
      const { data: tenants } = await supabase
        .from("tenants")
        .select("id, name")
        .order("name");

      if (!tenants) return [];

      // Get all restaurants with tenant mapping
      const { data: restaurants } = await supabase
        .from("restaurants")
        .select("id, tenant_id");

      const tenantRestaurants = new Map<string, string[]>();
      restaurants?.forEach(r => {
        const existing = tenantRestaurants.get(r.tenant_id) || [];
        tenantRestaurants.set(r.tenant_id, [...existing, r.id]);
      });

      // Get all messages
      const { data: allMessages } = await supabase
        .from("chat_messages")
        .select("id, restaurant_id, sender_id, created_at");

      // Get all channels
      const { data: allChannels } = await supabase
        .from("chat_channels")
        .select("id, restaurant_id");

      // Get all conversations
      const { data: allConversations } = await supabase
        .from("chat_conversations")
        .select("id, restaurant_id");

      // Calculate stats per tenant
      const stats: TenantStats[] = tenants.map(tenant => {
        const restaurantIds = tenantRestaurants.get(tenant.id) || [];
        
        const tenantMessages = allMessages?.filter(m => 
          restaurantIds.includes(m.restaurant_id)
        ) || [];
        
        const messagesLast7 = tenantMessages.filter(m => 
          new Date(m.created_at) >= new Date(sevenDaysAgo)
        );
        
        const messagesLast30 = tenantMessages.filter(m => 
          new Date(m.created_at) >= new Date(thirtyDaysAgo)
        );
        
        const uniqueUsers = new Set(messagesLast30.map(m => m.sender_id));
        
        const tenantChannels = allChannels?.filter(c => 
          restaurantIds.includes(c.restaurant_id)
        ) || [];
        
        const tenantConversations = allConversations?.filter(c => 
          restaurantIds.includes(c.restaurant_id)
        ) || [];

        return {
          tenantId: tenant.id,
          tenantName: tenant.name,
          totalMessages: tenantMessages.length,
          activeUsers: uniqueUsers.size,
          channelCount: tenantChannels.length,
          conversationCount: tenantConversations.length,
          messagesLast7Days: messagesLast7.length,
          messagesLast30Days: messagesLast30.length,
        };
      });

      // Sort by total messages descending
      return stats.sort((a, b) => b.totalMessages - a.totalMessages);
    },
  });

  const isLoading = platformLoading || tenantsLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Chat Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Platform-wide chat engagement metrics and tenant breakdowns.
          </p>
        </div>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Platform Overview */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card className="border-border/40">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Messages
                </CardTitle>
                <MessageSquare className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {platformStats?.totalMessages.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {platformStats?.messagesLast7Days.toLocaleString()} in last 7 days
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/40">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Active Users
                </CardTitle>
                <Users className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {platformStats?.totalActiveUsers.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  In last 30 days
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/40">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Channels
                </CardTitle>
                <Hash className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {platformStats?.totalChannels.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Across all tenants
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/40">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Direct Conversations
                </CardTitle>
                <MessagesSquare className="h-4 w-4 text-amber-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {platformStats?.totalConversations.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Private message threads
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Tenant Breakdown */}
          <Card className="border-border/40">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg font-medium">Tenant Breakdown</CardTitle>
              </div>
              <CardDescription>
                Chat engagement metrics per tenant
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tenantStats.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No tenant data available
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tenant</TableHead>
                        <TableHead className="text-right">Total Messages</TableHead>
                        <TableHead className="text-right">Last 7 Days</TableHead>
                        <TableHead className="text-right">Last 30 Days</TableHead>
                        <TableHead className="text-right">Active Users</TableHead>
                        <TableHead className="text-right">Channels</TableHead>
                        <TableHead className="text-right">DMs</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tenantStats.map((stat) => (
                        <TableRow key={stat.tenantId}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{stat.tenantName}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="secondary">
                              {stat.totalMessages.toLocaleString()}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {stat.messagesLast7Days.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {stat.messagesLast30Days.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {stat.activeUsers}
                          </TableCell>
                          <TableCell className="text-right">
                            {stat.channelCount}
                          </TableCell>
                          <TableCell className="text-right">
                            {stat.conversationCount}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
