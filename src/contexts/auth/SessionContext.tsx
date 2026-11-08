/**
 * Session slice — selects the session/identity subset of AuthCore.
 *
 * Stage A (this PR): a thin selector over the monolithic AuthCore context,
 * so new code can declare a narrow "I only depend on the session" surface
 * without coupling to the whole 30-field useAuth() blob.
 *
 * Stage B (future): replace the AuthCore body with a dedicated
 * SessionProvider that owns this state directly.
 */
import { useAuth } from "./AuthCore";

export interface SessionSlice {
  user: ReturnType<typeof useAuth>["user"];
  session: ReturnType<typeof useAuth>["session"];
  loading: boolean;
  signUp: ReturnType<typeof useAuth>["signUp"];
  signIn: ReturnType<typeof useAuth>["signIn"];
  signOut: ReturnType<typeof useAuth>["signOut"];
}

export function useSession(): SessionSlice {
  const { user, session, loading, signUp, signIn, signOut } = useAuth();
  return { user, session, loading, signUp, signIn, signOut };
}