/**
 * Device-level tenant pairing for the native APK ("SaaS compatibility").
 *
 * The first time a fresh device opens the app it must enter a tenant code
 * (the tenant slug shared by the workspace owner). We persist the resolved
 * tenant so subsequent launches skip straight to the login form, and so
 * `ProtectedRoute` / `Auth` can verify the signed-in user actually belongs
 * to this tenant - preventing a user from one workspace accidentally signing
 * in on a device paired to another.
 */
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "apk_device_tenant_v1";

export interface DeviceTenant {
  id: string;
  name: string;
  slug: string;
}

export function getDeviceTenant(): DeviceTenant | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeviceTenant;
    if (!parsed?.id || !parsed?.slug) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setDeviceTenant(t: DeviceTenant) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch {
    /* ignore quota errors */
  }
}

export function clearDeviceTenant() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function resolveTenantCode(code: string): Promise<DeviceTenant> {
  const slug = code.trim().toLowerCase();
  if (!slug) throw new Error("Enter a tenant code");

  const { data, error } = await supabase.functions.invoke("resolve-tenant-code", {
    body: { code: slug },
  });

  if (error) {
    // Edge function returns structured 4xx errors; surface server message when available.
    const msg =
      (data as { error?: string } | null)?.error ??
      error.message ??
      "Tenant code not found";
    throw new Error(msg);
  }

  const payload = data as { ok?: boolean; tenant?: DeviceTenant; error?: string };
  if (!payload?.ok || !payload.tenant) {
    throw new Error(payload?.error ?? "Tenant code not found");
  }
  return payload.tenant;
}