import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function ZohoCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"working" | "success" | "error">("working");
  const [message, setMessage] = useState("Finalizing connection with Zoho Books…");
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    const location = params.get("location") ?? undefined;
    const accounts_server = params.get("accounts-server") ?? undefined;

    const goBack = (qs: Record<string, string>) => {
      const search = new URLSearchParams({ tab: "accounting", ...qs }).toString();
      navigate(`/settings?${search}`, { replace: true });
    };

    if (error) {
      setStatus("error");
      setMessage(`Zoho returned: ${error}`);
      setTimeout(() => goBack({ zoho: "error", error }), 1500);
      return;
    }
    if (!code || !state) {
      setStatus("error");
      setMessage("Missing code or state from Zoho.");
      setTimeout(() => goBack({ zoho: "error", error: "missing_code_or_state" }), 1500);
      return;
    }

    // Must match exactly what was registered in Zoho and used at /authorize.
    const redirect_uri = "https://www.matbex.com/zoho/callback";

    supabase.functions
      .invoke("zoho-oauth-exchange", {
        body: { code, state, location, accounts_server, redirect_uri },
      })
      .then(({ data, error: invokeErr }) => {
        if (invokeErr || !data?.ok) {
          const err = data?.error ?? invokeErr?.message ?? "exchange_failed";
          setStatus("error");
          setMessage(`Connection failed: ${err}`);
          setTimeout(() => goBack({ zoho: "error", error: err }), 1500);
          return;
        }
        setStatus("success");
        setMessage("Connected. Redirecting…");
        setTimeout(() => goBack({ zoho: "connected" }), 800);
      });
  }, [params, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full text-center space-y-4">
        {status === "working" && <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />}
        {status === "success" && <CheckCircle2 className="h-10 w-10 mx-auto text-primary" />}
        {status === "error" && <AlertCircle className="h-10 w-10 mx-auto text-destructive" />}
        <h1 className="text-xl font-light">Zoho Books</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}