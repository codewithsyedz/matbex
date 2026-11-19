export interface UserFactor {
  id: string;
  friendly_name?: string;
  factor_type: "totp" | string;
  status: "verified" | "unverified";
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  aud: string;
  role?: string;
  email?: string;
  phone?: string;
  email_confirmed_at?: string | null;
  phone_confirmed_at?: string | null;
  confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  created_at: string;
  updated_at?: string;
  app_metadata: Record<string, any>;
  user_metadata: Record<string, any>;
  factors?: UserFactor[];
  identities?: any[];
  is_anonymous?: boolean;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  token_type: "bearer" | string;
  expires_in: number;
  /** Unix seconds */
  expires_at?: number;
  user: User;
}

export type AuthChangeEvent =
  | "INITIAL_SESSION"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED"
  | "PASSWORD_RECOVERY"
  | "MFA_CHALLENGE_VERIFIED";

export interface Subscription {
  id: string;
  unsubscribe: () => void;
}

export type AuthenticatorAssuranceLevel = "aal1" | "aal2";

export interface StorageLike {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface ClientOptions {
  auth?: {
    storage?: StorageLike;
    storageKey?: string;
    persistSession?: boolean;
    autoRefreshToken?: boolean;
    detectSessionInUrl?: boolean;
  };
  global?: {
    headers?: Record<string, string>;
    fetch?: typeof fetch;
  };
  db?: { schema?: string };
  realtime?: { params?: Record<string, unknown> };
}
