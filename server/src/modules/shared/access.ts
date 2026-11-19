/**
 * Role checks for /api/v1 modules (RBAC on top of Postgres RLS).
 *
 * A user may act on a restaurant with one of `roles` when they have that role on the
 * restaurant (user_roles), or a tenant-level owner/manager role on the restaurant's tenant
 * (user_tenant_roles), or are a superadmin.
 */
import { forbidden } from "../../lib/errors.js";
import type { Tx } from "../../db.js";

export type RestaurantRole = "owner" | "manager" | "cashier" | "accountant" | "waiter";

export interface RestaurantAccess {
  restaurantId: string;
  tenantId: string;
  roles: string[];
  superadmin: boolean;
}

export async function requireRestaurantRole(tx: Tx, userId: string, restaurantId: string, roles: RestaurantRole[]): Promise<RestaurantAccess> {
  const [row] = await tx<{ tenant_id: string | null; roles: string[] | null; superadmin: boolean }[]>`
    select r.tenant_id,
           array(
             select ur.role::text from public.user_roles ur where ur.user_id = ${userId} and ur.restaurant_id = r.id
             union
             select utr.role::text from public.user_tenant_roles utr
              where utr.user_id = ${userId} and utr.tenant_id = r.tenant_id and utr.role::text in ('owner', 'manager')
           ) as roles,
           public.is_superadmin(${userId}::uuid) as superadmin
    from public.restaurants r
    where r.id = ${restaurantId}`;
  // Same answer for "no such restaurant" and "not yours": do not reveal which ids exist.
  if (!row?.tenant_id) throw forbidden("No access to this restaurant", "restaurant_forbidden");
  const have = row.roles ?? [];
  if (!row.superadmin && !have.some((r) => (roles as string[]).includes(r))) {
    throw forbidden("Your role cannot do this in this restaurant", "role_forbidden");
  }
  return { restaurantId, tenantId: row.tenant_id, roles: have, superadmin: row.superadmin };
}
