import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Lock, Unlock, Calendar, Shield, AlertTriangle, Loader2, Check } from "lucide-react";
import { useFiscalPeriodLocks, FiscalPeriodLock } from "@/hooks/useFiscalPeriodLocks";
import { useFiscalSettings } from "@/hooks/useFiscalSettings";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

export function MonthlyCloseManager() {
  const { locks, isLoading, lockPeriod, unlockPeriod, getClosableMonths, isLocking, isUnlocking, getLockForPeriod } = useFiscalPeriodLocks();
  const { monthStartDay, isLoading: fiscalLoading } = useFiscalSettings();
  
  const [selectedMonth, setSelectedMonth] = useState<{ start: Date; end: Date; label: string } | null>(null);
  const [showLockConfirm, setShowLockConfirm] = useState(false);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [unlockLock, setUnlockLock] = useState<FiscalPeriodLock | null>(null);
  const [unlockReason, setUnlockReason] = useState("");

  const closableMonths = getClosableMonths(monthStartDay, 12);

  const handleLockMonth = () => {
    if (!selectedMonth) return;
    lockPeriod.mutate(
      { periodStart: selectedMonth.start, periodEnd: selectedMonth.end },
      {
        onSuccess: () => {
          setShowLockConfirm(false);
          setSelectedMonth(null);
        },
      }
    );
  };

  const handleUnlock = () => {
    if (!unlockLock || !unlockReason.trim()) return;
    unlockPeriod.mutate(
      { lockId: unlockLock.id, reason: unlockReason },
      {
        onSuccess: () => {
          setShowUnlockDialog(false);
          setUnlockLock(null);
          setUnlockReason("");
        },
      }
    );
  };

  const openUnlockDialog = (lock: FiscalPeriodLock) => {
    setUnlockLock(lock);
    setShowUnlockDialog(true);
  };

  if (isLoading || fiscalLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Monthly Close
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Monthly Close
          </CardTitle>
          <CardDescription>
            Lock completed fiscal months to prevent modifications. Locked periods ensure audit integrity.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Available months to lock */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Available Periods</Label>
            <div className="grid gap-2">
              {closableMonths.map((month) => {
                const existingLock = getLockForPeriod(month.start, month.end);
                const isLocked = existingLock?.is_locked;

                return (
                  <div
                    key={month.label}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      isLocked ? "bg-muted/50 border-primary/20" : "bg-background"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{month.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(month.start, "MMM d")} → {format(month.end, "MMM d, yyyy")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isLocked ? (
                        <>
                          <Badge variant="secondary" className="gap-1">
                            <Shield className="h-3 w-3" />
                            Locked
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openUnlockDialog(existingLock!)}
                          >
                            <Unlock className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedMonth(month);
                            setShowLockConfirm(true);
                          }}
                          className="gap-1"
                        >
                          <Lock className="h-3 w-3" />
                          Lock
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Locked periods history */}
          {locks.length > 0 && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Lock History</Label>
              <div className="text-xs text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
                {locks.map((lock) => (
                  <div key={lock.id} className="flex items-center gap-2">
                    {lock.is_locked ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <Unlock className="h-3 w-3 text-amber-500" />
                    )}
                    <span>
                      {format(new Date(lock.period_start), "MMM yyyy")} - 
                      {lock.is_locked
                        ? ` Locked ${format(new Date(lock.locked_at), "MMM d, yyyy")}`
                        : ` Unlocked ${format(new Date(lock.unlocked_at!), "MMM d, yyyy")}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lock Confirmation Dialog */}
      <AlertDialog open={showLockConfirm} onOpenChange={setShowLockConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Lock Fiscal Period
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  You are about to lock the period{" "}
                  <strong>{selectedMonth?.label}</strong>.
                </p>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-amber-700 dark:text-amber-400">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium">This action will:</p>
                      <ul className="list-disc list-inside mt-1 space-y-1">
                        <li>Prevent any new transactions in this period</li>
                        <li>Block modifications to existing transactions</li>
                        <li>Require owner approval to unlock</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLockMonth}
              disabled={isLocking}
              className="gap-1"
            >
              {isLocking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
              Lock Period
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unlock Dialog */}
      <Dialog open={showUnlockDialog} onOpenChange={setShowUnlockDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Unlock className="h-5 w-5" />
              Unlock Fiscal Period
            </DialogTitle>
            <DialogDescription>
              Unlocking a period allows modifications to transactions within that timeframe.
              A reason is required for audit purposes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-sm font-medium">
                Period: {unlockLock && format(new Date(unlockLock.period_start), "MMMM yyyy")}
              </p>
              <p className="text-xs text-muted-foreground">
                {unlockLock && `${format(new Date(unlockLock.period_start), "MMM d")} → ${format(new Date(unlockLock.period_end), "MMM d, yyyy")}`}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="unlock-reason">Reason for Unlock *</Label>
              <Textarea
                id="unlock-reason"
                placeholder="Explain why this period needs to be unlocked..."
                value={unlockReason}
                onChange={(e) => setUnlockReason(e.target.value)}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                This reason will be recorded in the audit log.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUnlockDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUnlock}
              disabled={isUnlocking || !unlockReason.trim()}
              variant="destructive"
              className="gap-1"
            >
              {isUnlocking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Unlock className="h-4 w-4" />
              )}
              Unlock Period
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
