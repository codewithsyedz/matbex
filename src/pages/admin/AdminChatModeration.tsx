import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Trash2, MessageSquare, Building2, User, FileText, Image } from "lucide-react";
import { format } from "date-fns";

interface ChatMessageWithDetails {
  id: string;
  content: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
  attachment_name: string | null;
  created_at: string;
  sender_id: string;
  restaurant_id: string;
  channel_id: string | null;
  conversation_id: string | null;
  is_edited: boolean | null;
}

interface Tenant {
  id: string;
  name: string;
}

export default function AdminChatModeration() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTenant, setSelectedTenant] = useState<string>("all");

  // Fetch tenants for filter
  const { data: tenants = [] } = useQuery({
    queryKey: ["admin-tenants-list"],
    queryFn: async () => {
      const { data, error } = await db
        .from("tenants")
        .select("id, name")
        .order("name");
      
      if (error) throw error;
      return data as Tenant[];
    },
  });

  // Fetch messages with tenant info
  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["admin-chat-messages", selectedTenant, searchTerm],
    queryFn: async () => {
      let query = db
        .from("chat_messages")
        .select(`
          id,
          content,
          attachment_url,
          attachment_type,
          attachment_name,
          created_at,
          sender_id,
          restaurant_id,
          channel_id,
          conversation_id,
          is_edited
        `)
        .order("created_at", { ascending: false })
        .limit(100);

      if (searchTerm) {
        query = query.ilike("content", `%${searchTerm}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      // Get restaurant-tenant mapping for filtering
      const restaurantIds = [...new Set((data || []).map(m => m.restaurant_id))];
      const { data: restaurants } = await db
        .from("restaurants")
        .select("id, tenant_id, name")
        .in("id", restaurantIds);
      
      const restaurantMap = new Map(restaurants?.map(r => [r.id, r]) || []);
      
      // Get sender profiles
      const senderIds = [...new Set((data || []).map(m => m.sender_id))];
      const { data: profiles } = await db
        .from("profiles")
        .select("id, full_name")
        .in("id", senderIds);
      
      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      
      // Enrich and filter messages
      let enrichedMessages = (data || []).map(msg => ({
        ...msg,
        restaurant: restaurantMap.get(msg.restaurant_id),
        sender: profileMap.get(msg.sender_id),
      }));
      
      if (selectedTenant !== "all") {
        enrichedMessages = enrichedMessages.filter(
          msg => msg.restaurant?.tenant_id === selectedTenant
        );
      }
      
      return enrichedMessages;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const { error } = await db
        .from("chat_messages")
        .delete()
        .eq("id", messageId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-chat-messages"] });
      toast({ title: "Message deleted" });
    },
    onError: (error) => {
      toast({ 
        title: "Error deleting message", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Chat Moderation
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          View and moderate chat messages across all tenants.
        </p>
      </div>

      <Card className="border-border/40">
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg font-medium">All Messages</CardTitle>
          </div>
          <CardDescription>
            Search and manage messages from all tenants
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search messages..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={selectedTenant} onValueChange={setSelectedTenant}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Filter by tenant" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tenants</SelectItem>
                {tenants.map((tenant) => (
                  <SelectItem key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No messages found
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sender</TableHead>
                    <TableHead>Content</TableHead>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.map((message: any) => (
                    <TableRow key={message.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">
                            {message.sender?.full_name || "Unknown"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-xs truncate">
                          {message.content ? (
                            <span>{message.content}</span>
                          ) : message.attachment_url ? (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              {message.attachment_type?.startsWith("image/") ? (
                                <Image className="h-4 w-4" />
                              ) : (
                                <FileText className="h-4 w-4" />
                              )}
                              <span>{message.attachment_name || "Attachment"}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">No content</span>
                          )}
                          {message.is_edited && (
                            <Badge variant="outline" className="ml-2 text-xs">
                              edited
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">
                            {message.restaurant?.name || "Unknown"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {format(new Date(message.created_at), "MMM d, yyyy HH:mm")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Message</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete this message? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(message.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
