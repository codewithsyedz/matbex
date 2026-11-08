/**
 * Back-compat shim. The auth provider tree now lives under `./auth/*`.
 * This file is preserved so the ~195 consumer imports of
 * `@/contexts/AuthContext` keep working unchanged.
 */
export {
  AuthProvider,
  AuthContext,
  useAuth,
  type ImpersonatableRole,
} from "./auth/AuthFacade";