import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Mail, Loader2, Send } from "lucide-react";
import { format } from "date-fns";

interface SendProfitSummaryButtonProps {
  date: Date;
}

export function SendProfitSummaryButton({ date }: SendProfitSummaryButtonProps) {
  const { restaurant, user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState(user?.email || "");

  const sendSummaryMutation = useMutation({
    mutationFn: async () => {
      if (!restaurant?.id || !email) {
        throw new Error("Missing required data");
      }

      const { data, error } = await db.functions.invoke("send-daily-profit-summary", {
        body: {
          restaurant_id: restaurant.id,
          email,
          date: format(date, "yyyy-MM-dd"),
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Profit summary sent to your email");
      setIsOpen(false);
    },
    onError: (error) => {
      console.error("Send summary error:", error);
      toast.error("Failed to send summary. Please try again.");
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Mail className="h-4 w-4" />
          Email Summary
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Send Daily Profit Summary
          </DialogTitle>
          <DialogDescription>
            Send the profit summary for {format(date, "MMMM d, yyyy")} to your email.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button
            onClick={() => sendSummaryMutation.mutate()}
            disabled={!email || sendSummaryMutation.isPending}
            className="w-full"
          >
            {sendSummaryMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Mail className="h-4 w-4 mr-2" />
                Send Summary
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
