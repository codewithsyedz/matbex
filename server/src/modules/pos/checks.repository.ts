/**
 * Data access for open checks (pos_checks, pos_check_lines, pos_check_rounds) and the kitchen
 * tickets their rounds make. Every query is scoped by restaurant_id: modules run as the table
 * owner (see modules/shared/db.ts), so RLS is not the safety net here.
 */
import type { ServiceTx } from "../shared/db.js";

export interface CheckRow {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  table_id: string | null;
  table_label: string | null;
  check_number: string;
  name: string | null;
  status: "open" | "paid" | "void" | "merged";
  guest_count: number | null;
  server_id: string | null;
  customer_id: string | null;
  notes: string | null;
  opened_at: string;
  version: number;
  service_charge_waived: boolean;
}

export interface LineRow {
  id: string;
  menu_item_id: string | null;
  combo_id: string | null;
  name: string;
  size: string;
  quantity: number;
  unit_price: number;
  note: string | null;
  round_id: string | null;
  round_number: number | null;
  status: "active" | "voided";
  created_at: string;
}

export function checksRepository({ tx }: ServiceTx) {
  return {
    async table(restaurantId: string, tableId: string) {
      const [r] = await tx<{ id: string; label: string; branch_id: string | null; status: string }[]>`
        select id, label, branch_id, status from public.pos_tables
        where id = ${tableId} and restaurant_id = ${restaurantId} and deleted_at is null and coalesce(is_active, true)
        for update`;
      return r ?? null;
    },

    async setTableStatus(restaurantId: string, tableId: string, status: string, extra: { guestCount?: number | null; serverId?: string | null } = {}) {
      await tx`
        update public.pos_tables
           set status = ${status},
               seated_at = case when ${status} = 'seated' and status <> 'seated' then now()
                                when ${status} in ('free', 'dirty') then null else seated_at end,
               guest_count = case when ${status} in ('free', 'dirty') then null else coalesce(${extra.guestCount ?? null}::int, guest_count) end,
               server_id = case when ${status} in ('free', 'dirty') then null else coalesce(${extra.serverId ?? null}::uuid, server_id) end
         where id = ${tableId} and restaurant_id = ${restaurantId}`;
    },

    async nextCheckNumber(restaurantId: string) {
      const [r] = await tx<{ n: number; day: string }[]>`
        with d as (
          select (now() at time zone coalesce(r.timezone, 'Asia/Riyadh'))::date as day
          from public.restaurants r where r.id = ${restaurantId}
        )
        insert into platform.pos_check_counters (restaurant_id, day, last_value)
        select ${restaurantId}, d.day, 1 from d
        on conflict (restaurant_id, day) do update set last_value = platform.pos_check_counters.last_value + 1
        returning last_value as n, to_char(day, 'YYYYMMDD') as day`;
      return `CHK-${r.day}-${String(r.n).padStart(3, "0")}`;
    },

    async insertCheck(v: {
      restaurantId: string; branchId: string | null; tableId: string | null; checkNumber: string; name: string | null;
      guestCount: number | null; serverId: string; customerId: string | null; notes: string | null; openedBy: string;
    }) {
      const [r] = await tx<{ id: string }[]>`
        insert into public.pos_checks
          (restaurant_id, branch_id, table_id, check_number, name, guest_count, server_id, customer_id, notes, opened_by)
        values (${v.restaurantId}, ${v.branchId}, ${v.tableId}, ${v.checkNumber}, ${v.name}, ${v.guestCount},
                ${v.serverId}, ${v.customerId}, ${v.notes}, ${v.openedBy})
        returning id`;
      return r.id;
    },

    /** The check, locked for this transaction when `lock`. */
    async check(restaurantId: string, checkId: string, { lock = false } = {}) {
      const rows = lock
        ? await tx<CheckRow[]>`
            select c.*, null::text as table_label from public.pos_checks c
            where c.id = ${checkId} and c.restaurant_id = ${restaurantId} for update`
        : await tx<CheckRow[]>`
            select c.*, t.label as table_label from public.pos_checks c
            left join public.pos_tables t on t.id = c.table_id
            where c.id = ${checkId} and c.restaurant_id = ${restaurantId}`;
      return rows[0] ?? null;
    },

    async tableLabel(restaurantId: string, tableId: string | null) {
      if (!tableId) return null;
      const [r] = await tx<{ label: string }[]>`select label from public.pos_tables where id = ${tableId} and restaurant_id = ${restaurantId}`;
      return r?.label ?? null;
    },

    async openChecks(restaurantId: string, branchId: string | null) {
      return tx<(CheckRow & { item_count: number; unsent_count: number; lines_total: number })[]>`
        select c.*, t.label as table_label,
               coalesce(sum(l.quantity) filter (where l.status = 'active'), 0)::int as item_count,
               coalesce(sum(l.quantity) filter (where l.status = 'active' and l.round_id is null), 0)::int as unsent_count,
               coalesce(sum(round(l.unit_price * l.quantity, 2)) filter (where l.status = 'active'), 0)::float8 as lines_total
        from public.pos_checks c
        left join public.pos_tables t on t.id = c.table_id
        left join public.pos_check_lines l on l.check_id = c.id
        where c.restaurant_id = ${restaurantId} and c.status = 'open'
          and (${branchId}::uuid is null or c.branch_id = ${branchId}::uuid)
        group by c.id, t.label
        order by c.opened_at`;
    },

    async lines(restaurantId: string, checkId: string) {
      return tx<LineRow[]>`
        select l.id, l.menu_item_id, l.combo_id, coalesce(m.name, cp.name, 'Item') as name, l.size, l.quantity,
               l.unit_price::float8 as unit_price, l.note, l.round_id, r.number as round_number, l.status, l.created_at::text
        from public.pos_check_lines l
        left join public.menu_items m on m.id = l.menu_item_id
        left join public.combo_packages cp on cp.id = l.combo_id
        left join public.pos_check_rounds r on r.id = l.round_id
        where l.check_id = ${checkId} and l.restaurant_id = ${restaurantId}
        order by l.created_at, l.id`;
    },

    async rounds(restaurantId: string, checkId: string) {
      return tx<{ id: string; number: number; sent_at: string; kds_ticket_id: string | null }[]>`
        select id, number, sent_at::text, kds_ticket_id from public.pos_check_rounds
        where check_id = ${checkId} and restaurant_id = ${restaurantId} order by number`;
    },

    async insertLines(restaurantId: string, checkId: string, userId: string, lines: { menuItemId: string | null; comboId: string | null; size: string; quantity: number; unitPrice: number; note: string | null }[]) {
      for (const l of lines) {
        await tx`
          insert into public.pos_check_lines (check_id, restaurant_id, menu_item_id, combo_id, size, quantity, unit_price, note, added_by)
          values (${checkId}, ${restaurantId}, ${l.menuItemId}, ${l.comboId}, ${l.size}, ${l.quantity}, ${l.unitPrice}::numeric, ${l.note}, ${userId})`;
      }
    },

    async line(restaurantId: string, checkId: string, lineId: string) {
      const [r] = await tx<{ id: string; round_id: string | null; status: string }[]>`
        select id, round_id, status from public.pos_check_lines
        where id = ${lineId} and check_id = ${checkId} and restaurant_id = ${restaurantId} for update`;
      return r ?? null;
    },

    async updateLine(restaurantId: string, lineId: string, patch: { quantity?: number; note?: string | null }) {
      await tx`
        update public.pos_check_lines
           set quantity = coalesce(${patch.quantity ?? null}::int, quantity),
               note = case when ${patch.note !== undefined} then ${patch.note ?? null} else note end
         where id = ${lineId} and restaurant_id = ${restaurantId}`;
    },

    async voidLine(restaurantId: string, lineId: string, userId: string, reason: string | null) {
      await tx`
        update public.pos_check_lines set status = 'voided', voided_by = ${userId}, voided_at = now(), void_reason = ${reason}
         where id = ${lineId} and restaurant_id = ${restaurantId}`;
    },

    async bump(restaurantId: string, checkId: string) {
      const [r] = await tx<{ version: number }[]>`
        update public.pos_checks set version = version + 1 where id = ${checkId} and restaurant_id = ${restaurantId} returning version`;
      return r.version;
    },

    async close(restaurantId: string, checkId: string, status: "paid" | "void", userId: string, reason: string | null = null) {
      await tx`
        update public.pos_checks set status = ${status}, closed_by = ${userId}, closed_at = now(), void_reason = ${reason}
         where id = ${checkId} and restaurant_id = ${restaurantId}`;
    },

    /**
     * Sends every unsent active line as the next round: one kitchen ticket with one item per
     * line (a combo as its component items). Returns null when there was nothing to send.
     */
    async sendRound(restaurantId: string, check: CheckRow, userId: string, label: string) {
      const unsent = await tx<{ id: string }[]>`
        select id from public.pos_check_lines
        where check_id = ${check.id} and restaurant_id = ${restaurantId} and status = 'active' and round_id is null`;
      if (!unsent.length) return null;
      const [round] = await tx<{ id: string; number: number }[]>`
        insert into public.pos_check_rounds (check_id, restaurant_id, number, sent_by)
        values (${check.id}, ${restaurantId},
                (select coalesce(max(number), 0) + 1 from public.pos_check_rounds where check_id = ${check.id}), ${userId})
        returning id, number`;
      await tx`
        update public.pos_check_lines set round_id = ${round.id}
         where check_id = ${check.id} and restaurant_id = ${restaurantId} and status = 'active' and round_id is null`;
      const [ticket] = await tx<{ id: string }[]>`
        insert into public.pos_kds_tickets (restaurant_id, ticket_number, source, source_order_id, table_label, status, priority)
        values (${restaurantId}, ${`${check.check_number}-R${round.number}`}, 'check', ${round.id}, ${label}, 'new', 0)
        returning id`;
      await tx`
        insert into public.pos_kds_ticket_items
          (ticket_id, restaurant_id, menu_item_id, name_snapshot, size_label, quantity, notes, sort_order, check_line_id)
        select ${ticket.id}, ${restaurantId}, x.menu_item_id, x.name, x.size_label, x.quantity, x.notes,
               (row_number() over (order by x.created_at, x.ord) - 1)::int, x.line_id
        from (
          select l.id as line_id, l.menu_item_id, coalesce(m.name, 'Item') as name,
                 nullif(l.size, 'regular') as size_label, l.quantity::numeric as quantity, l.note as notes, l.created_at, 0 as ord
          from public.pos_check_lines l
          left join public.menu_items m on m.id = l.menu_item_id
          where l.round_id = ${round.id} and l.menu_item_id is not null
          union all
          select l.id, ci.menu_item_id, coalesce(m.name, 'Item'), ci.portion_type,
                 (l.quantity * coalesce(ci.quantity, 1))::numeric,
                 concat_ws(' · ', cp.name, l.note), l.created_at, 1
          from public.pos_check_lines l
          join public.combo_packages cp on cp.id = l.combo_id
          join public.combo_package_items ci on ci.combo_id = l.combo_id
          left join public.menu_items m on m.id = ci.menu_item_id
          where l.round_id = ${round.id} and l.combo_id is not null
        ) x`;
      await tx`update public.pos_check_rounds set kds_ticket_id = ${ticket.id} where id = ${round.id}`;
      return { roundId: round.id, number: round.number, ticketId: ticket.id };
    },

    async hasSentRounds(restaurantId: string, checkId: string) {
      const [r] = await tx<{ ok: boolean }[]>`
        select exists(select 1 from public.pos_check_rounds where check_id = ${checkId} and restaurant_id = ${restaurantId}) as ok`;
      return !!r?.ok;
    },

    /** The branch's service charge percent (0 = none). */
    async serviceChargePercent(restaurantId: string, branchId: string | null) {
      const [r] = await tx<{ pct: number }[]>`
        select coalesce(b.service_charge_percent, 0)::float8 as pct from public.branches b
        where b.restaurant_id = ${restaurantId} and b.deleted_at is null
          and (b.id = ${branchId}::uuid or (${branchId}::uuid is null and b.is_primary))
        order by (b.id = ${branchId}::uuid) desc nulls last limit 1`;
      return r?.pct ?? 0;
    },

    async setServiceChargeWaived(restaurantId: string, checkId: string, waived: boolean, userId: string, reason: string | null) {
      await tx`
        update public.pos_checks
           set service_charge_waived = ${waived},
               service_charge_waived_by = case when ${waived} then ${userId}::uuid else null end,
               service_charge_waive_reason = case when ${waived} then ${reason} else null end
         where id = ${checkId} and restaurant_id = ${restaurantId}`;
    },

    /** True when `pin` is the restaurant's tenant admin PIN (bcrypt, like verify_tenant_admin_pin). */
    async adminPinMatches(restaurantId: string, pin: string) {
      const [r] = await tx<{ ok: boolean }[]>`
        select coalesce(t.admin_pin_hash is not null and t.admin_pin_hash = extensions.crypt(${pin}, t.admin_pin_hash), false) as ok
        from public.restaurants r join public.tenants t on t.id = r.tenant_id
        where r.id = ${restaurantId}`;
      return !!r?.ok;
    },

    async lineFull(restaurantId: string, checkId: string, lineId: string) {
      const [r] = await tx<{ id: string; menu_item_id: string | null; combo_id: string | null; size: string; quantity: number; unit_price: string; note: string | null; round_id: string | null; status: string; added_by: string }[]>`
        select id, menu_item_id, combo_id, size, quantity, unit_price::text, note, round_id, status, added_by
        from public.pos_check_lines where id = ${lineId} and check_id = ${checkId} and restaurant_id = ${restaurantId} for update`;
      return r ?? null;
    },

    /**
     * Voids `quantity` of a line. A partial void keeps the line with fewer units and adds a
     * voided copy for the removed ones (same round), so history shows both. Returns the id of
     * the voided line.
     */
    async voidUnits(restaurantId: string, line: { id: string; quantity: number }, quantity: number, v: { userId: string; reason: string | null; approval: string; approvedBy: string | null }) {
      if (quantity >= line.quantity) {
        await tx`
          update public.pos_check_lines
             set status = 'voided', voided_by = ${v.userId}, voided_at = now(), void_reason = ${v.reason},
                 void_approval = ${v.approval}, void_approved_by = ${v.approvedBy}
           where id = ${line.id} and restaurant_id = ${restaurantId}`;
        return line.id;
      }
      await tx`update public.pos_check_lines set quantity = quantity - ${quantity} where id = ${line.id} and restaurant_id = ${restaurantId}`;
      const [copy] = await tx<{ id: string }[]>`
        insert into public.pos_check_lines
          (check_id, restaurant_id, menu_item_id, combo_id, size, quantity, unit_price, note, round_id, status,
           void_reason, voided_by, voided_at, void_approval, void_approved_by, added_by, created_at)
        select check_id, restaurant_id, menu_item_id, combo_id, size, ${quantity}, unit_price, note, round_id, 'voided',
               ${v.reason}, ${v.userId}, now(), ${v.approval}, ${v.approvedBy}, added_by, created_at
        from public.pos_check_lines where id = ${line.id} and restaurant_id = ${restaurantId}
        returning id`;
      return copy.id;
    },

    /** Cancels (or reduces) the kitchen items a sent line became: a combo is several items. */
    async cancelKitchenUnits(restaurantId: string, lineId: string, quantity: number, lineQuantity: number) {
      if (quantity >= lineQuantity) {
        await tx`
          update public.pos_kds_ticket_items set status = 'cancelled'
           where check_line_id = ${lineId} and restaurant_id = ${restaurantId}`;
        return;
      }
      // Each item holds lineQuantity × component quantity; keep the rest, mark nothing cancelled.
      await tx`
        update public.pos_kds_ticket_items
           set quantity = quantity - quantity * ${quantity}::numeric / ${lineQuantity}::numeric,
               notes = concat_ws(' · ', notes, ${`-${quantity} voided`}::text)
         where check_line_id = ${lineId} and restaurant_id = ${restaurantId}`;
    },

    /**
     * Records `quantity` units of a sent line as waste: one waste_records row per recipe
     * ingredient (combos through their components), stock lowered atomically with a 'waste'
     * stock movement. The waste_records trigger posts the expense. Returns the total cost.
     */
    async recordWaste(restaurantId: string, v: { lineId: string; menuItemId: string | null; comboId: string | null; quantity: number; userId: string; notes: string }) {
      const [r] = await tx<{ cost: number }[]>`
        with rest as (
          select r.tenant_id, (now() at time zone coalesce(r.timezone, 'Asia/Riyadh'))::date as day
          from public.restaurants r where r.id = ${restaurantId}
        ),
        parts as (
          select ${v.menuItemId}::uuid as menu_item_id, 1::numeric as per_unit where ${v.menuItemId}::uuid is not null
          union all
          select ci.menu_item_id, coalesce(ci.quantity, 1)::numeric from public.combo_package_items ci
          where ${v.comboId}::uuid is not null and ci.combo_id = ${v.comboId}::uuid
        ),
        need as (
          select ri.inventory_item_id, sum(ri.quantity_required * p.per_unit * ${v.quantity}::numeric) as qty
          from parts p
          join public.recipe_ingredients ri on ri.menu_item_id = p.menu_item_id and ri.restaurant_id = ${restaurantId}
          group by ri.inventory_item_id
        ),
        upd as (
          update public.inventory_items i set current_stock = i.current_stock - n.qty, updated_at = now()
          from need n where i.id = n.inventory_item_id and i.restaurant_id = ${restaurantId}
          returning i.id, i.current_stock as after, n.qty, coalesce(i.unit_cost, 0) as unit_cost
        ),
        mv as (
          insert into public.stock_movements
            (tenant_id, restaurant_id, inventory_item_id, movement_type, quantity_change, stock_before, stock_after,
             reason, reference_type, reference_id, created_by)
          select rest.tenant_id, ${restaurantId}, u.id, 'waste', -u.qty, u.after + u.qty, u.after,
                 ${v.notes}, 'check_line', ${v.lineId}, ${v.userId}
          from upd u, rest
          returning 1
        ),
        ws as (
          insert into public.waste_records
            (restaurant_id, inventory_item_id, quantity_wasted, unit_cost, total_cost, waste_reason, notes, recorded_by, waste_date, check_line_id)
          select ${restaurantId}, u.id, u.qty, u.unit_cost, round(u.qty * u.unit_cost, 4), 'voided_order', ${v.notes}, ${v.userId}, rest.day, ${v.lineId}
          from upd u, rest
          returning total_cost
        )
        select coalesce(sum(total_cost), 0)::float8 as cost from ws, (select count(*) from mv) m`;
      const cost = r?.cost ?? 0;
      await tx`update public.pos_check_lines set waste_cost = ${cost} where id = ${v.lineId} and restaurant_id = ${restaurantId}`;
      return cost;
    },

    async moveTo(restaurantId: string, checkId: string, tableId: string) {
      await tx`update public.pos_checks set table_id = ${tableId} where id = ${checkId} and restaurant_id = ${restaurantId}`;
    },

    /** Moves the lines and rounds of `fromId` onto `intoId` (rounds renumbered after the target's). */
    async mergeInto(restaurantId: string, intoId: string, fromId: string, userId: string) {
      const [{ max }] = await tx<{ max: number }[]>`
        select coalesce(max(number), 0)::int as max from public.pos_check_rounds where check_id = ${intoId}`;
      await tx`update public.pos_check_rounds set check_id = ${intoId}, number = number + ${max}
                where check_id = ${fromId} and restaurant_id = ${restaurantId}`;
      await tx`update public.pos_check_lines set check_id = ${intoId} where check_id = ${fromId} and restaurant_id = ${restaurantId}`;
      await tx`update public.pos_checks set status = 'merged', merged_into = ${intoId}, closed_by = ${userId}, closed_at = now()
                where id = ${fromId} and restaurant_id = ${restaurantId}`;
    },

    /** Voided sent items of a business day, for the open-checks report. */
    async voidsOfDay(restaurantId: string, branchId: string | null, day: string) {
      return tx<{ check_number: string; name: string; quantity: number; reason: string | null; approval: string | null; voided_by: string | null; voided_at: string; waste_cost: number; line_total: number }[]>`
        select c.check_number, coalesce(m.name, cp.name, 'Item') as name, l.quantity, l.void_reason as reason, l.void_approval as approval,
               coalesce(p.full_name, u.email) as voided_by, l.voided_at::text, coalesce(l.waste_cost, 0)::float8 as waste_cost,
               round(l.unit_price * l.quantity, 2)::float8 as line_total
        from public.pos_check_lines l
        join public.pos_checks c on c.id = l.check_id
        join public.restaurants r on r.id = c.restaurant_id
        left join public.menu_items m on m.id = l.menu_item_id
        left join public.combo_packages cp on cp.id = l.combo_id
        left join public.profiles p on p.id = l.voided_by
        left join auth.users u on u.id = l.voided_by
        where l.restaurant_id = ${restaurantId} and l.status = 'voided' and l.round_id is not null
          and (${branchId}::uuid is null or c.branch_id = ${branchId}::uuid)
          and (l.voided_at at time zone coalesce(r.timezone, 'Asia/Riyadh'))::date = ${day}::date
        order by l.voided_at`;
    },

    async dayTotals(restaurantId: string, branchId: string | null, day: string) {
      const [r] = await tx<{ paid_checks: number; service_charge: number; checks_sales: number }[]>`
        select count(distinct s.check_id)::int as paid_checks,
               coalesce(sum(s.service_charge), 0)::float8 as service_charge,
               coalesce(sum(s.total), 0)::float8 as checks_sales
        from public.sales_transactions s join public.restaurants r on r.id = s.restaurant_id
        where s.restaurant_id = ${restaurantId} and s.check_id is not null and s.voids_transaction_id is null
          and (${branchId}::uuid is null or s.branch_id = ${branchId}::uuid)
          and (s.created_at at time zone coalesce(r.timezone, 'Asia/Riyadh'))::date = ${day}::date`;
      return r;
    },

    async businessDay(restaurantId: string) {
      const [r] = await tx<{ day: string }[]>`
        select to_char((now() at time zone coalesce(timezone, 'Asia/Riyadh'))::date, 'YYYY-MM-DD') as day
        from public.restaurants where id = ${restaurantId}`;
      return r.day;
    },

    async emit(restaurantId: string, checkId: string, type: string, payload: Record<string, unknown>) {
      await tx`select platform.emit_event('pos', ${type}, ${restaurantId}::uuid, ${checkId}::uuid, ${JSON.stringify(payload)}::jsonb)`;
    },
  };
}
