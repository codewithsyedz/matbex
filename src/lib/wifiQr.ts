/**
 * Helpers for the standard Wi-Fi QR payload format:
 *   WIFI:T:WPA;S:MySSID;P:secret;H:true;;
 * Used so an owner can display network credentials on any screen and a kiosk
 * tablet can join by scanning, without leaving lock-task mode.
 */
export type WifiSecurity = "WPA" | "WEP" | "nopass";

export interface WifiCredentials {
  ssid: string;
  password: string;
  security: WifiSecurity;
  hidden: boolean;
}

function escapeValue(value: string): string {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

export function buildWifiQrPayload(creds: WifiCredentials): string {
  const parts = [
    `T:${creds.security}`,
    `S:${escapeValue(creds.ssid)}`,
    creds.security === "nopass" ? "" : `P:${escapeValue(creds.password)}`,
    creds.hidden ? "H:true" : "",
  ].filter(Boolean);
  return `WIFI:${parts.join(";")};;`;
}

export function parseWifiQrPayload(raw: string): WifiCredentials | null {
  const text = raw.trim();
  if (!/^WIFI:/i.test(text)) return null;
  const body = text.slice(5);

  const fields: Record<string, string> = {};
  let key = "";
  let value = "";
  let readingKey = true;
  let escaped = false;

  for (const char of body) {
    if (escaped) {
      value += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (readingKey && char === ":") {
      readingKey = false;
      continue;
    }
    if (!readingKey && char === ";") {
      if (key) fields[key.toUpperCase()] = value;
      key = "";
      value = "";
      readingKey = true;
      continue;
    }
    if (readingKey) key += char;
    else value += char;
  }
  if (key && !readingKey) fields[key.toUpperCase()] = value;

  const ssid = fields.S ?? "";
  if (!ssid) return null;

  const rawType = (fields.T ?? "WPA").toUpperCase();
  const security: WifiSecurity =
    rawType === "NOPASS" || rawType === ""
      ? "nopass"
      : rawType === "WEP"
        ? "WEP"
        : "WPA";

  return {
    ssid,
    password: fields.P ?? "",
    security,
    hidden: (fields.H ?? "").toLowerCase() === "true",
  };
}
