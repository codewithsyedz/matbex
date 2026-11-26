/** Environment access for server functions (process.env with legacy names mapped). */
const LEGACY: Record<string, string> = {
  API_URL: "API_URL",
  SERVICE_ROLE_KEY: "SERVICE_ROLE_KEY",
  ANON_KEY: "ANON_KEY",
  SUPABASE_PUBLISHABLE_KEY: "ANON_KEY",
};

export function env(name: string): string | undefined {
  return process.env[name] ?? (LEGACY[name] ? process.env[LEGACY[name]] : undefined);
}

export function envObject(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>;
}
