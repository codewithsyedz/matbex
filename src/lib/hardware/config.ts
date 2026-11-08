import { DEFAULT_HARDWARE_CONFIG, type HardwareConfig } from "./types";

const STORAGE_KEY = "matbex.hardware.config.v1";

export function loadHardwareConfig(): HardwareConfig {
  if (typeof window === "undefined") return DEFAULT_HARDWARE_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_HARDWARE_CONFIG;
    return { ...DEFAULT_HARDWARE_CONFIG, ...(JSON.parse(raw) as Partial<HardwareConfig>) };
  } catch {
    return DEFAULT_HARDWARE_CONFIG;
  }
}

export function saveHardwareConfig(config: HardwareConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore quota errors - settings will revert next session
  }
}

export const HARDWARE_CONFIG_EVENT = "matbex:hardware-config-changed";

export function emitConfigChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(HARDWARE_CONFIG_EVENT));
}