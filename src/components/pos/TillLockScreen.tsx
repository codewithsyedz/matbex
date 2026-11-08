import { useEffect, useMemo, useState } from "react";
import { Delete, Lock, ShieldAlert, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { readCachedStaffPins, verifyStaffPin } from "@/lib/pos/staffPin";
import { useTranslation } from "react-i18next";

interface TillLockScreenProps {
  restaurantId: string;
  restaurantName?: string | null;
  online: boolean;
  onUnlock: (staff: { user_id: string; display_name: string }) => void;
}

/**
 * Full-screen till sign-in. Staff tap their name (optional) and key their PIN.
 * Verification runs entirely against the locally cached hashes, so it works
 * with no internet.
 */
export function TillLockScreen({
  restaurantId,
  restaurantName,
  online,
  onUnlock,
}: TillLockScreenProps) {
  const { t } = useTranslation();
  const roster = useMemo(() => readCachedStaffPins(restaurantId), [restaurantId]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (error) setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const submit = async (value: string) => {
    setBusy(true);
    const result = await verifyStaffPin(restaurantId, value, selected);
    setBusy(false);
    if (result.ok && result.staff) {
      setPin("");
      onUnlock(result.staff);
      return;
    }
    setPin("");
    setError(
      result.lockedForMs
        ? t("app.pos.till.lock.tooManyAttempts", { minutes: Math.ceil(result.lockedForMs / 60000) })
        : result.error ?? t("app.pos.till.lock.incorrectPin"),
    );
  };

  const press = (digit: string) => {
    const next = (pin + digit).slice(0, 8);
    setPin(next);
    if (next.length >= 4 && next.length === 8) void submit(next);
  };

  const hasRoster = roster.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 space-y-5">
          <div className="text-center space-y-1">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <h1 className="text-lg font-semibold">{t("app.pos.till.lock.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {restaurantName ? `${restaurantName} — ` : ""}{t("app.pos.till.lock.prompt")}
            </p>
            {!online && (
              <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <WifiOff className="h-3.5 w-3.5" /> {t("app.pos.till.lock.offline")}
              </p>
            )}
          </div>

          {!hasRoster ? (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground space-y-2">
              <ShieldAlert className="mx-auto h-5 w-5" />
              <p>{t("app.pos.till.lock.noPins")}</p>
              <p>{t("app.pos.till.lock.noPinsHelp")}</p>
            </div>
          ) : (
            <>
              {roster.length > 1 && (
                <div className="flex flex-wrap justify-center gap-2">
                  {roster.map((r) => (
                    <Button
                      key={r.user_id}
                      type="button"
                      size="sm"
                      variant={selected === r.user_id ? "default" : "outline"}
                      className="min-h-[44px]"
                      onClick={() => setSelected(selected === r.user_id ? null : r.user_id)}
                    >
                      {r.display_name}
                    </Button>
                  ))}
                </div>
              )}

              <div className="flex justify-center gap-2" aria-label={t("app.pos.till.lock.pinEntry")}>
                {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-3 w-3 rounded-full ${i < pin.length ? "bg-primary" : "bg-muted"}`}
                  />
                ))}
              </div>

              {error && (
                <p className="text-center text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}

              <div className="grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                  <Button
                    key={d}
                    type="button"
                    variant="outline"
                    className="h-14 text-lg"
                    disabled={busy}
                    onClick={() => press(d)}
                  >
                    {d}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  className="h-14"
                  disabled={busy || pin.length === 0}
                  onClick={() => setPin(pin.slice(0, -1))}
                  aria-label={t("app.pos.till.lock.deleteDigit")}
                >
                  <Delete className="h-5 w-5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-14 text-lg"
                  disabled={busy}
                  onClick={() => press("0")}
                >
                  0
                </Button>
                <Button
                  type="button"
                  className="h-14"
                  disabled={busy || pin.length < 4}
                  onClick={() => void submit(pin)}
                >
                  {t("app.pos.till.lock.enter")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
