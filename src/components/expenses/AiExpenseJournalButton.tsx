import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";

interface AiExpenseJournalButtonProps {
  expenseId: string;
  disabled?: boolean;
}

export function AiExpenseJournalButton({ expenseId, disabled }: AiExpenseJournalButtonProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [posting, setPosting] = useState(false);

  const postJournal = async () => {
    setPosting(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-expense-journal", {
        body: { expense_id: expenseId },
      });
      if (error) {
        const context = error.context as Response | undefined;
        let message = error.message;
        if (context) {
          const payload = await context.clone().json().catch(() => null);
          message = payload?.error || message;
        }
        throw new Error(message);
      }
      toast.success(t("expenses.aiJournal.posted", {
        account: `${data.account.code} · ${data.account.name}`,
        confidence: Math.round(Number(data.confidence) * 100),
      }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["expenses"] }),
        queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["account-transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["trial-balance"] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("expenses.aiJournal.failed"));
    } finally {
      setPosting(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={disabled || posting}
          aria-label={t("expenses.aiJournal.action")}
          onClick={postJournal}
        >
          <Sparkles className={posting ? "h-4 w-4 animate-pulse text-primary" : "h-4 w-4 text-primary"} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{posting ? t("expenses.aiJournal.posting") : t("expenses.aiJournal.action")}</TooltipContent>
    </Tooltip>
  );
}
