import { z } from "zod";

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(8000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),

  /** Public base URL of this API, e.g. https://api.matbex.com */
  API_URL: z.string().url(),
  /** Public base URL of the web app, e.g. https://app.matbex.com */
  SITE_URL: z.string().url(),
  /** Extra allowed redirect / CORS origins (comma-separated, wildcards allowed: https://*.matbex.com) */
  ALLOWED_ORIGINS: z.string().default(""),

  /** Owner connection (migrations, auth, service operations). */
  DATABASE_URL: z.string(),
  /** Internal PostgREST URL the /rest/v1 gateway forwards to. */
  POSTGREST_URL: z.string().url().default("http://127.0.0.1:3000"),

  JWT_SECRET: z.string().min(32),
  JWT_EXPIRY_SECONDS: z.coerce.number().default(3600),
  REFRESH_TOKEN_REUSE_SECONDS: z.coerce.number().default(10),
  SERVICE_ROLE_KEY: z.string(),
  ANON_KEY: z.string(),

  AUTH_AUTOCONFIRM: bool.default(false),
  AUTH_DISABLE_SIGNUP: bool.default(false),
  AUTH_MIN_PASSWORD_LENGTH: z.coerce.number().default(8),
  AUTH_MFA_ISSUER: z.string().default("Matbex"),

  EMAIL_FROM: z.string().default("Matbex <noreply@mail.matbex.com>"),
  RESEND_API_KEY: z.string().optional(),

  STORAGE_DRIVER: z.enum(["fs", "s3"]).default("fs"),
  STORAGE_FS_ROOT: z.string().default("./.data/storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("matbex"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(true),
  STORAGE_MAX_UPLOAD_MB: z.coerce.number().default(50),

  JOBS_ENABLED: bool.default(true),
  CRON_SECRET: z.string().optional(),
  /** JSON object {functionName: cronExpr} overriding jobs/schedules.ts */
  JOB_SCHEDULES_JSON: z.string().optional(),

  /** Internal Prometheus endpoint (/metrics). 0 disables it. Never expose it publicly. */
  METRICS_PORT: z.coerce.number().default(9464),
  METRICS_HOST: z.string().default("127.0.0.1"),

  /** redis://[:password@]host:6379/0 — cache + shared rate-limit counters. Optional. */
  REDIS_URL: z.string().optional(),
  REDIS_KEY_PREFIX: z.string().default("matbex:"),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-5"),
});

export type Config = z.infer<typeof schema>;

export const config: Config = (() => {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment:\n" + parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n"));
    process.exit(1);
  }
  return parsed.data;
})();

/** Origins allowed for CORS and auth redirects. */
export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  const allowed = [config.SITE_URL, config.API_URL, ...config.ALLOWED_ORIGINS.split(",")]
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return allowed.some((pattern) => {
    if (!pattern.includes("*")) return origin === pattern;
    const re = new RegExp("^" + pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[a-z0-9-]+") + "$", "i");
    return re.test(origin);
  });
}

export function safeRedirect(target: string | undefined | null): string {
  if (!target) return config.SITE_URL;
  try {
    const u = new URL(target, config.SITE_URL);
    if (isAllowedOrigin(u.origin) || u.hostname === "localhost") return u.toString();
  } catch { /* fall through */ }
  return config.SITE_URL;
}
