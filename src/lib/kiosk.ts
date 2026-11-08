/**
 * Thin bridge to the native MatbexKiosk Capacitor plugin (Android only).
 * On web / unsupported platforms every call degrades gracefully.
 */
export interface KioskStatus {
  supported: boolean;
  locked: boolean;
  deviceOwner: boolean;
}

function getPlugin(): any | null {
  const cap = (window as any)?.Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return cap?.Plugins?.MatbexKiosk ?? null;
}

export function isNativeKioskAvailable(): boolean {
  return getPlugin() !== null;
}

export async function getKioskStatus(): Promise<KioskStatus> {
  const plugin = getPlugin();
  if (!plugin) return { supported: false, locked: false, deviceOwner: false };
  try {
    const res = await plugin.status();
    return {
      supported: true,
      locked: !!res?.locked,
      deviceOwner: !!res?.deviceOwner,
    };
  } catch {
    return { supported: false, locked: false, deviceOwner: false };
  }
}

export async function exitKioskMode(): Promise<{ ok: boolean; error?: string }> {
  const plugin = getPlugin();
  if (!plugin) return { ok: false, error: "Kiosk mode is only available on the Android app" };
  try {
    await plugin.exitKiosk();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function enterKioskMode(): Promise<{ ok: boolean; error?: string }> {
  const plugin = getPlugin();
  if (!plugin) return { ok: false, error: "Kiosk mode is only available on the Android app" };
  try {
    await plugin.enterKiosk();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface WifiStatus {
  supported: boolean;
  wifiEnabled: boolean;
  connected: boolean;
  ssid: string | null;
}

export async function getWifiStatus(): Promise<WifiStatus> {
  const plugin = getPlugin();
  if (!plugin?.wifiStatus) {
    return { supported: false, wifiEnabled: false, connected: false, ssid: null };
  }
  try {
    const res = await plugin.wifiStatus();
    return {
      supported: true,
      wifiEnabled: !!res?.wifiEnabled,
      connected: !!res?.connected,
      ssid: res?.ssid ?? null,
    };
  } catch {
    return { supported: false, wifiEnabled: false, connected: false, ssid: null };
  }
}

/**
 * Opens the Android Wi-Fi picker. Kiosk (lock task) mode blocks Settings, so by
 * default the native side releases the lock first and the caller re-locks after.
 */
export async function openWifiSettings(
  releaseLock = true,
): Promise<{ ok: boolean; lockReleased: boolean; error?: string }> {
  const plugin = getPlugin();
  if (!plugin?.openWifiSettings) {
    return {
      ok: false,
      lockReleased: false,
      error: "Wi-Fi settings can only be opened from the Android app",
    };
  }
  try {
    const res = await plugin.openWifiSettings({ releaseLock });
    return { ok: true, lockReleased: !!res?.lockReleased };
  } catch (e) {
    return {
      ok: false,
      lockReleased: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export interface JoinWifiResult {
  ok: boolean;
  method?: "config" | "suggestion";
  kioskPreserved?: boolean;
  error?: string;
}

/**
 * Applies Wi-Fi credentials natively (no Settings screen, kiosk stays locked).
 */
export async function joinWifiNetwork(creds: {
  ssid: string;
  password: string;
  security: "WPA" | "WEP" | "nopass";
  hidden?: boolean;
}): Promise<JoinWifiResult> {
  const plugin = getPlugin();
  if (!plugin?.joinWifi) {
    return { ok: false, error: "Joining Wi-Fi is only supported in the Android app" };
  }
  try {
    const res = await plugin.joinWifi({ hidden: false, ...creds });
    return {
      ok: !!res?.applied,
      method: res?.method,
      kioskPreserved: !!res?.kioskPreserved,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}