import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export const HELP_CATEGORIES = {
  question: "A question",
  problem: "Something is not working",
  billing: "Billing or my plan",
  feature: "An idea or feature request",
  other: "Something else",
} as const;
export type HelpCategory = keyof typeof HELP_CATEGORIES;

/** Calls support-request and returns its JSON, with the function's own error message. */
export async function callSupport<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.functions.invoke("support-request", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const msg = ctx && typeof ctx.json === "function" ? await ctx.json().then((b: { error?: string }) => b?.error).catch(() => null) : null;
    throw new Error(msg || error.message);
  }
  return data as T;
}

/**
 * "Contact support": the request carries the page the user is on, their branch, screen size and
 * app version; the server adds their recent errors, so support sees what they saw.
 */
export function HelpRequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [category, setCategory] = useState<HelpCategory>("question");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  // The page they opened help from (the dialog itself does not change the route).
  const [fromPage, setFromPage] = useState("");

  useEffect(() => {
    if (!open) return;
    setFromPage(location.pathname + location.search);
    setCategory("question"); setSubject(""); setMessage("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: () => {
      const branch = new URLSearchParams(location.search).get("branch");
      return callSupport<{ id: string; number: number }>({
        action: "create", category, subject: subject.trim(), message: message.trim(),
        page_path: fromPage.slice(0, 300), page_title: document.title.slice(0, 200),
        ...(branch && /^[0-9a-f-]{36}$/i.test(branch) ? { branch_id: branch } : {}),
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        app_version: String((import.meta as { env?: Record<string, string> }).env?.VITE_RELEASE ?? "").slice(0, 60) || undefined,
      });
    },
    onSuccess: (r) => {
      toast.success(`Request #${r.number} sent. We'll reply by email and on the Help page.`, {
        action: { label: "View", onClick: () => navigate(`/support?request=${r.id}`) },
      });
      void qc.invalidateQueries({ queryKey: ["support-requests"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><LifeBuoy className="h-5 w-5 text-primary" />Contact Matbex support</DialogTitle>
          <DialogDescription>
            We see the page you are on and any recent errors, so you don't need to describe those. We reply by email and on the Help page.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>What is it about?</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as HelpCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(HELP_CATEGORIES) as HelpCategory[]).map((k) => <SelectItem key={k} value={k}>{HELP_CATEGORIES[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="help-subject">Subject</Label>
            <Input id="help-subject" maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Receipt printer stopped printing" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="help-message">Message</Label>
            <Textarea id="help-message" rows={5} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)}
              placeholder="What happened, and what did you expect? Steps to repeat it help us fix it faster." />
          </div>
          {fromPage && <p className="text-xs text-muted-foreground">Sent from: <span className="font-mono">{fromPage.split("?")[0]}</span></p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); navigate("/support"); }}>My requests</Button>
          <Button onClick={() => send.mutate()} disabled={subject.trim().length < 3 || message.trim().length < 3 || send.isPending}>
            {send.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
