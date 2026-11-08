import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useVarianceThresholds } from "@/hooks/useShiftVariance";
import { useCurrency } from "@/hooks/useCurrency";
import { Loader2, Scale, AlertTriangle, Save } from "lucide-react";

export function VarianceSettings() {
  const { thresholds, isLoading, updateThresholds } = useVarianceThresholds();
  const { format: formatCurrency } = useCurrency();

  const [minor, setMinor] = useState<string>("10");
  const [investigate, setInvestigate] = useState<string>("50");
  const [escalate, setEscalate] = useState<string>("100");
  const [requireExplanation, setRequireExplanation] = useState<string>("10");
  const [requireAdjustment, setRequireAdjustment] = useState<boolean>(false);
  const [notifyManager, setNotifyManager] = useState<boolean>(true);

  useEffect(() => {
    if (!thresholds) return;
    setMinor(String(thresholds.minor_threshold ?? 10));
    setInvestigate(String(thresholds.investigate_threshold ?? 50));
    setEscalate(String(thresholds.escalate_threshold ?? 100));
    setRequireExplanation(String(thresholds.require_explanation_above ?? 10));
    setRequireAdjustment(!!thresholds.require_adjustment_for_close);
    setNotifyManager(thresholds.notify_manager_enabled !== false);
  }, [thresholds]);

  const minorN = parseFloat(minor) || 0;
  const investigateN = parseFloat(investigate) || 0;
  const escalateN = parseFloat(escalate) || 0;

  const orderError =
    minorN < 0 || investigateN <= minorN || escalateN <= investigateN
      ? "Thresholds must satisfy: minor < investigate < escalate."
      : null;

  const handleSave = () => {
    if (orderError) return;
    updateThresholds.mutate({
      minor_threshold: minorN,
      investigate_threshold: investigateN,
      escalate_threshold: escalateN,
      require_explanation_above: parseFloat(requireExplanation) || 0,
      require_adjustment_for_close: requireAdjustment,
      notify_manager_enabled: notifyManager,
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          Variance Thresholds
        </CardTitle>
        <CardDescription>
          Set the cash/card variance bands and closure rules used by Day-End and shift reconciliation
          for this restaurant.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Minor variance ≤</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={minor}
                  onChange={(e) => setMinor(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Closes immediately. Currently {formatCurrency(minorN)}.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Investigate variance ≤</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={investigate}
                  onChange={(e) => setInvestigate(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Requires resolution wizard. Currently {formatCurrency(investigateN)}.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Escalate variance &gt;</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={escalate}
                  onChange={(e) => setEscalate(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Notifies manager. Currently {formatCurrency(escalateN)}.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Require explanation above</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={requireExplanation}
                onChange={(e) => setRequireExplanation(e.target.value)}
                className="md:max-w-[200px]"
              />
              <p className="text-[11px] text-muted-foreground">
                A written variance note becomes mandatory once variance exceeds this amount.
              </p>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <Label className="text-sm">Require Day-End Adjustment for closure</Label>
                  <p className="text-xs text-muted-foreground">
                    When on, closing a day with any cash/card variance requires a posted Day-End
                    Adjustment - an explanation note alone won't unlock the Close Day button.
                  </p>
                </div>
                <Switch checked={requireAdjustment} onCheckedChange={setRequireAdjustment} />
              </div>

              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <Label className="text-sm">Notify manager on escalated variance</Label>
                  <p className="text-xs text-muted-foreground">
                    Send an alert when variance crosses the escalate threshold.
                  </p>
                </div>
                <Switch checked={notifyManager} onCheckedChange={setNotifyManager} />
              </div>
            </div>

            {orderError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{orderError}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleSave}
                disabled={!!orderError || updateThresholds.isPending}
                className="gap-2"
              >
                {updateThresholds.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Thresholds
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}