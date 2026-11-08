import { useCallback, useEffect, useState } from "react";
import { db } from "@/integrations/db/client";

const TOKEN_KEY = "matbex_customer_token";
const CUSTOMER_KEY = "matbex_customer";

export interface CustomerSession {
  id: string;
  phone: string;
  name?: string | null;
  email?: string | null;
}

function readSession(): { token: string | null; customer: CustomerSession | null } {
  if (typeof window === "undefined") return { token: null, customer: null };
  const token = localStorage.getItem(TOKEN_KEY);
  const raw = localStorage.getItem(CUSTOMER_KEY);
  let customer: CustomerSession | null = null;
  if (raw) {
    try { customer = JSON.parse(raw); } catch { customer = null; }
  }
  return { token, customer };
}

export function useCustomerAuth() {
  const [state, setState] = useState(() => readSession());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY || e.key === CUSTOMER_KEY) setState(readSession());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(CUSTOMER_KEY);
    setState({ token: null, customer: null });
  }, []);

  const setSession = useCallback((token: string, customer: CustomerSession) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
    setState({ token, customer });
  }, []);

  const sendOtp = useCallback(async (phone: string) => {
    const { data, error } = await db.functions.invoke("customer-send-otp", {
      body: { phone },
    });
    if (error) throw new Error(error.message);
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as { ok: true; expires_at: string };
  }, []);

  const verifyOtp = useCallback(
    async (phone: string, code: string, name?: string) => {
      const { data, error } = await db.functions.invoke("customer-verify-otp", {
        body: { phone, code, name },
      });
      if (error) throw new Error(error.message);
      const d = data as any;
      if (d?.error) throw new Error(d.error);
      setSession(d.token, d.customer);
      return d.customer as CustomerSession;
    },
    [setSession],
  );

  const apiFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = state.token ?? localStorage.getItem(TOKEN_KEY);
      if (!token) throw new Error("Not signed in");
      const url = `${import.meta.env.VITE_API_URL}/functions/v1/customer-orders${path}`;
      const res = await fetch(url, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (res.status === 401) {
        signOut();
        throw new Error("Session expired");
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
      return json;
    },
    [state.token, signOut],
  );

  return {
    customer: state.customer,
    token: state.token,
    isAuthenticated: !!state.token,
    sendOtp,
    verifyOtp,
    signOut,
    apiFetch,
  };
}