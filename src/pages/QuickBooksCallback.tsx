import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { db } from "@/integrations/db/client";

export default function QuickBooksCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"working" | "success" | "error">("working");
  const [message, setMessage] = useState("Finalizing connection with QuickBooks…");
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const code = params.get("code");
    const state = params.get("state");
    const realmId = params.get("realmId") ?? undefined;
    const error = params.get("error");

    const goBack = (qs: Record<string, string>) => {
      const search = new URLSearchParams({ tab: "accounting", ...qs }).toString();
      navigate(`/settings?${search}`, { replace: true });
    };

    if (error) {
      setStatus("error");
      setMessage(`QuickBooks returned: ${error}`);
      setTimeout(() => goBack({ quickbooks: "error", error }), 1500);
      return;
    }
    if (!code || !state) {
      setStatus("error");
      setMessage("Missing code or state from QuickBooks.");
      setTimeout(() => goBack({ quickbooks: "error", error: "missing_code_or_state" }), 1500);
      return;
    }

    // Must match exactly what is registered in the Intuit developer portal.
    const redirect_uri = "https://www.matbex.com/quickbooks/callback";

    db.functions
      .invoke("quickbooks-oauth-exchange", {
        body: { code, state, realm_id: realmId, redirect_uri },
      })
      .then(({ data, error: invokeErr }) => {
        if (invokeErr || !data?.ok) {
          const err = data?.error ?? invokeErr?.message ?? "exchange_failed";
          setStatus("error");
          setMessage(`Connection failed: ${err}`);
          setTimeout(() => goBack({ quickbooks: "error", error: err }), 1500);
          return;
        }
        setStatus("success");
        setMessage("Connected. Redirecting…");
        setTimeout(() => goBack({ quickbooks: "connected" }), 800);
      });
  }, [params, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full text-center space-y-4">
        {status === "working" && <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />}
        {status === "success" && <CheckCircle2 className="h-10 w-10 mx-auto text-primary" />}
        {status === "error" && <AlertCircle className="h-10 w-10 mx-auto text-destructive" />}
        <h1 className="text-xl font-light">QuickBooks Online</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}