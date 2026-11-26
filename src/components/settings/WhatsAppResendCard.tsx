import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Send, Eye, Loader2, AlertCircle, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWhatsAppSubscription } from "@/hooks/useWhatsAppSubscription";
import { useAuthRedirectCheck, isRedirectConfigHealthy } from "@/hooks/useAuthRedirectCheck";

/** YYYY-MM-DD for the Riyadh-local instant represented by a Date (assumed local). */
function toYmd(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/**
 * Settings control to preview or re-send the WhatsApp daily summary
 * for any past date - useful after late COGS approvals to verify that
 * the magic-link delivery still works.
 */
export function WhatsAppResendCard() {
  const { subscription, preview, resend } = useWhatsAppSubscription();
  const redirectCheck = useAuthRedirectCheck();
  const redirectHealthy = isRedirectConfigHealthy(redirectCheck.data);
  const redirectChecked = !!redirectCheck.data && !redirectCheck.isFetching;
  const [date, setDate] = useState<Date | undefined>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1); // default to yesterday
    return d;
  });

  const ymd = useMemo(() => (date ? toYmd(date) : ""), [date]);
  const previewData = preview.data;
  const showPreviewForCurrent = previewData?.ymd === ymd;

  const onPreview = () => {
    if (!ymd) return;
    preview.mutate({ date: ymd });
  };

  const onResend = () => {
    if (!ymd) return;
    if (redirectChecked && !redirectHealthy) {
      const proceed = window.confirm(
        "Auth redirect allowlist check failed - magic-links may not auto-login on fresh devices. Send anyway?",
      );
      if (!proceed) return;
    }
    resend.mutate({ date: ymd });
  };

  const noSubscription = !subscription?.enabled;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          Re-send WhatsApp summary
        </CardTitle>
        <CardDescription>
          Pick a past date to preview the message or trigger a fresh delivery
          (bypasses the once-per-day guard) - handy after late COGS approvals.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Date</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-[220px] justify-start text-left font-normal",
                    !date && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "EEE, d MMM yyyy") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  disabled={(d) => d > new Date()}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          <Button
            variant="outline"
            onClick={onPreview}
            disabled={!ymd || preview.isPending}
          >
            {preview.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Eye className="mr-2 h-4 w-4" />
            )}
            Preview
          </Button>

          <Button
            onClick={onResend}
            disabled={!ymd || resend.isPending || noSubscription}
          >
            {resend.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Re-send to my WhatsApp
          </Button>
        </div>

        {noSubscription && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>WhatsApp summary not enabled</AlertTitle>
            <AlertDescription>
              Enable your WhatsApp subscription above to use re-send. Preview still works.
            </AlertDescription>
          </Alert>
        )}

        {redirectChecked && !redirectHealthy && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Redirect allowlist mismatch</AlertTitle>
            <AlertDescription>
              Sending now will likely produce magic-links that don't auto-login on
              fresh devices. Fix the auth redirect allowlist (SITE_URL / ALLOWED_ORIGINS) (see the check above)
              before re-sending.
            </AlertDescription>
          </Alert>
        )}

        {showPreviewForCurrent && previewData?.message && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground mb-2">
              Preview for {ymd} (links shown are plain - magic links are only
              generated when actually sending):
            </p>
            <ScrollArea className="max-h-[260px]">
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                {previewData.message}
              </pre>
            </ScrollArea>
          </div>
        )}
      </CardContent>

      <CardFooter className="text-xs text-muted-foreground">
        Re-sends are logged in the WhatsApp delivery log below with{" "}
        <span className="font-mono mx-1">test: true</span> for traceability.
      </CardFooter>
    </Card>
  );
}