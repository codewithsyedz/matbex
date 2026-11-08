import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Mail, Trash2, Archive, CheckCircle2, Inbox, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type ContactMessage = {
  id: string;
  name: string;
  email: string;
  message: string;
  user_agent: string | null;
  created_at: string;
  status: "new" | "read" | "archived";
  handled_at: string | null;
  handled_by: string | null;
  admin_notes: string | null;
  kind: "enquiry" | "demo";
  company: string | null;
  phone: string | null;
  branch_count: string | null;
  preferred_date: string | null;
  preferred_slot: string | null;
};

type StatusFilter = "all" | "new" | "read" | "archived" | "demo";

export default function AdminContactMessages() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<StatusFilter>("new");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ContactMessage | null>(null);
  const [notes, setNotes] = useState("");

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["admin-contact-messages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ContactMessage[];
    },
  });

  const update = useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<ContactMessage> }) => {
      const { error } = await supabase
        .from("contact_messages")
        .update({
          ...vars.patch,
          handled_at: new Date().toISOString(),
        })
        .eq("id", vars.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-contact-messages"] });
      toast.success("Updated");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contact_messages").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-contact-messages"] });
      setSelected(null);
      toast.success("Message deleted");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to delete"),
  });

  const counts = {
    all: messages.length,
    new: messages.filter((m) => m.status === "new").length,
    read: messages.filter((m) => m.status === "read").length,
    archived: messages.filter((m) => m.status === "archived").length,
    demo: messages.filter((m) => m.kind === "demo").length,
  };

  const visible = messages.filter((m) => {
    if (filter === "demo") {
      if (m.kind !== "demo") return false;
    } else if (filter !== "all" && m.status !== filter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      m.name.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      m.message.toLowerCase().includes(q)
    );
  });

  const openMessage = (m: ContactMessage) => {
    setSelected(m);
    setNotes(m.admin_notes ?? "");
    if (m.status === "new") {
      update.mutate({ id: m.id, patch: { status: "read" } });
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Inbox className="w-6 h-6 text-[#00A859]" />
            Contact Messages
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Inbound submissions from the public contact form and live demo bookings.
          </p>
        </div>
        <Badge variant="secondary" className="text-sm">
          {counts.new} new
        </Badge>
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
              <TabsList>
                <TabsTrigger value="new">New ({counts.new})</TabsTrigger>
                <TabsTrigger value="read">Read ({counts.read})</TabsTrigger>
                <TabsTrigger value="demo">Demos ({counts.demo})</TabsTrigger>
                <TabsTrigger value="archived">Archived ({counts.archived})</TabsTrigger>
                <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative w-full md:w-72">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, message"
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No messages in this view.
            </div>
          ) : (
            <ScrollArea className="max-h-[70vh]">
              <div className="divide-y">
                {visible.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => openMessage(m)}
                    className="w-full text-left py-4 px-2 hover:bg-muted/40 transition-colors flex items-start gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium truncate">{m.name}</span>
                        <span className="text-xs text-muted-foreground truncate">
                          {m.email}
                        </span>
                        {m.kind === "demo" && (
                          <Badge variant="outline" className="border-[#00A859]/50 text-[#00A859] text-[10px] h-5">
                            DEMO
                            {m.preferred_date ? ` · ${m.preferred_date}` : ""}
                          </Badge>
                        )}
                        {m.status === "new" && (
                          <Badge className="bg-[#00A859] hover:bg-[#00A859]/90 text-white text-[10px] h-5">
                            NEW
                          </Badge>
                        )}
                        {m.status === "archived" && (
                          <Badge variant="outline" className="text-[10px] h-5">
                            Archived
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {m.message}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-[#00A859]" />
              {selected?.name}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <ScrollArea className="max-h-[70vh] pr-2">
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Email</div>
                    <a
                      href={`mailto:${selected.email}`}
                      className="text-[#00A859] hover:underline break-all"
                    >
                      {selected.email}
                    </a>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Received</div>
                    <div>{new Date(selected.created_at).toLocaleString()}</div>
                  </div>
                </div>
                {selected.kind === "demo" && (
                  <div className="rounded-md border border-[#00A859]/30 bg-[#00A859]/5 p-3">
                    <div className="text-xs font-medium text-[#00A859] mb-2">
                      Live demo request
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs text-muted-foreground">Requested slot</div>
                        <div>
                          {selected.preferred_date ?? "—"}
                          {selected.preferred_slot ? ` · ${selected.preferred_slot}` : ""}
                          <span className="text-xs text-muted-foreground"> (Riyadh)</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Restaurant</div>
                        <div>{selected.company ?? "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Branches</div>
                        <div>{selected.branch_count ?? "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Phone</div>
                        <div>
                          {selected.phone ? (
                            <a href={`tel:${selected.phone}`} className="text-[#00A859] hover:underline">
                              {selected.phone}
                            </a>
                          ) : (
                            "—"
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    {selected.kind === "demo" ? "Focus areas" : "Message"}
                  </div>
                  <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 leading-relaxed">
                    {selected.message || "—"}
                  </div>
                </div>
                {selected.user_agent && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">User agent</div>
                    <div className="text-xs text-muted-foreground break-all">
                      {selected.user_agent}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Internal notes</div>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Add notes for the team…"
                  />
                  <div className="mt-2 flex justify-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        update.mutate({
                          id: selected.id,
                          patch: { admin_notes: notes },
                        })
                      }
                      disabled={update.isPending}
                    >
                      Save notes
                    </Button>
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
          <DialogFooter className="gap-2 sm:gap-2 sm:justify-between">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => selected && remove.mutate(selected.id)}
              disabled={remove.isPending}
            >
              <Trash2 className="w-4 h-4 mr-1" /> Delete
            </Button>
            <div className="flex gap-2">
              {selected?.status !== "archived" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    selected &&
                    update.mutate({ id: selected.id, patch: { status: "archived" } })
                  }
                >
                  <Archive className="w-4 h-4 mr-1" /> Archive
                </Button>
              )}
              {selected?.status !== "read" && (
                <Button
                  size="sm"
                  className="bg-[#00A859] hover:bg-[#00A859]/90 text-white"
                  onClick={() =>
                    selected &&
                    update.mutate({ id: selected.id, patch: { status: "read" } })
                  }
                >
                  <CheckCircle2 className="w-4 h-4 mr-1" /> Mark as read
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}