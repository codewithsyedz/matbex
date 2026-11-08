import { serve } from "../_runtime/serve.ts";
import { env } from "../_runtime/env.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";
function getLocalDayRangeUTC(timeZone: string, now: Date) {
  const ymdFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const ymdParts = ymdFormatter.formatToParts(now);
  const getPartValue = (type: string) => ymdParts.find((p) => p.type === type)?.value || '';

  const year = Number(getPartValue('year'));
  const month = Number(getPartValue('month'));
  const day = Number(getPartValue('day'));

  const offsetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
  });
  const tzName = offsetFormatter.formatToParts(now).find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  const match = tzName.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);

  let offsetMinutes = 0;
  if (match) {
    const sign = match[1].startsWith('-') ? -1 : 1;
    const hours = Math.abs(parseInt(match[1], 10));
    const minutes = match[2] ? parseInt(match[2], 10) : 0;
    offsetMinutes = sign * (hours * 60 + minutes);
  }

  // local = UTC + offset  =>  UTC = local - offset
  const startUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMinutes * 60_000);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60_000 - 1);

  return { startIso: startUtc.toISOString(), endIso: endUtc.toISOString() };
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const unauthorized = await guardCronCaller(req, corsHeaders);
  if (unauthorized) return unauthorized;

  try {
    const apiUrl = env("API_URL")!;
    const serviceRoleKey = env("SERVICE_ROLE_KEY")!;
    const db = createClient(apiUrl, serviceRoleKey);

    console.log('Starting auto-shift manager (per-template)...');
    
    const results: any[] = [];
    let closedCount = 0;
    let openedCount = 0;
    let salesCreatedCount = 0;

    // ========== AUTO-CLOSE LOGIC ==========
    const { data: openShifts, error: shiftsError } = await db
      .from('shifts')
      .select(`
        id, 
        drawer_id, 
        opening_float, 
        restaurant_id,
        template_id,
        opened_at
      `)
      .eq('status', 'open');

    if (shiftsError) {
      console.error('Error fetching open shifts:', shiftsError);
      throw shiftsError;
    }

    console.log(`Found ${openShifts?.length || 0} open shifts`);

    for (const shift of openShifts || []) {
      if (!shift.template_id) {
        console.log(`Shift ${shift.id}: No template, skipping`);
        continue;
      }

      const { data: template, error: templateError } = await db
        .from('shift_templates')
        .select('id, name, start_time, auto_close_enabled, auto_close_time, default_closing_amount')
        .eq('id', shift.template_id)
        .single();

      if (templateError || !template) {
        console.log(`Shift ${shift.id}: Could not fetch template, skipping`);
        continue;
      }

      if (!template.auto_close_enabled) {
        console.log(`Shift ${shift.id}: Auto-close disabled for template ${template.name}, skipping`);
        continue;
      }

      const { data: restaurant, error: restaurantError } = await db
        .from('restaurants')
        .select('id, name, timezone')
        .eq('id', shift.restaurant_id)
        .single();

      if (restaurantError || !restaurant) {
        console.log(`Shift ${shift.id}: No restaurant found, skipping`);
        continue;
      }

      try {
        const now = new Date();
        const timezone = restaurant.timezone || 'Asia/Riyadh';
        
        const localFormatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
        
        const localParts = localFormatter.formatToParts(now);
        const getPartValue = (type: string) => localParts.find(p => p.type === type)?.value || '';
        
        const currentDate = `${getPartValue('year')}-${getPartValue('month')}-${getPartValue('day')}`;
        const currentTimeStr = `${getPartValue('hour')}:${getPartValue('minute')}`;
        const [currentHour, currentMinute] = [parseInt(getPartValue('hour')), parseInt(getPartValue('minute'))];
        
        const shiftOpenedDate = new Date(shift.opened_at);
        const shiftLocalParts = localFormatter.formatToParts(shiftOpenedDate);
        const getShiftPartValue = (type: string) => shiftLocalParts.find(p => p.type === type)?.value || '';
        const shiftDate = `${getShiftPartValue('year')}-${getShiftPartValue('month')}-${getShiftPartValue('day')}`;
        
        if (!template.auto_close_time) {
          console.log(`Shift ${shift.id}: Template ${template.name} has auto-close enabled but no auto_close_time, skipping`);
          continue;
        }

        const [closeHour, closeMinute] = template.auto_close_time
          .split(':')
          .slice(0, 2)
          .map(Number);
        const [startHour, startMinute] = (template.start_time || '00:00:00')
          .split(':')
          .slice(0, 2)
          .map(Number);

        const currentMinutes = currentHour * 60 + currentMinute;
        const startMinutes = startHour * 60 + startMinute;
        const closeMinutes = closeHour * 60 + closeMinute;

        const ymdFromUTC = (d: Date) =>
          `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        const addDaysToYMD = (ymd: string, days: number) => {
          const [y, m, dd] = ymd.split('-').map(Number);
          const base = new Date(Date.UTC(y, m - 1, dd));
          base.setUTCDate(base.getUTCDate() + days);
          return ymdFromUTC(base);
        };

        const scheduledCloseDate = closeMinutes < startMinutes
          ? addDaysToYMD(shiftDate, 1)
          : shiftDate;

        console.log(
          `Shift ${shift.id} (${template.name}): Shift date ${shiftDate}, Scheduled close date ${scheduledCloseDate}, Current date ${currentDate}, Current time ${currentTimeStr}, Auto-close time ${template.auto_close_time}`
        );

        const shouldClose =
          currentDate > scheduledCloseDate ||
          (currentDate === scheduledCloseDate && currentMinutes >= closeMinutes);

        if (!shouldClose) {
          console.log(`Not yet time to auto-close shift ${shift.id} (${template.name})`);
          continue;
        }

        console.log(`Auto-closing shift: ${shift.id} (${template.name})`);

        const { data: cashEvents } = await db
          .from('cash_events')
          .select('event_type, amount, payment_method')
          .eq('shift_id', shift.id);

        const expectedCash = shift.opening_float +
          (cashEvents || [])
            .filter((e: any) => e.payment_method === 'cash')
            .reduce((sum: number, e: any) => {
              if (e.event_type === 'sale') return sum + e.amount;
              if (e.event_type === 'refund') return sum - e.amount;
              if (e.event_type === 'drop') return sum - e.amount;
              if (e.event_type === 'add') return sum + e.amount;
              if (e.event_type === 'remove') return sum - e.amount;
              // Signed adjustments (e.g. BNPL installment payouts from the drawer)
              if (e.event_type === 'adjustment') return sum + e.amount;
              if (e.event_type === 'deposit') return sum - Math.abs(e.amount);
              return sum;
            }, 0);

        const countedCash = template.default_closing_amount || 0;
        const variance = countedCash - expectedCash;

        const { error: closeError } = await db
          .from('shifts')
          .update({
            status: 'closed',
            counted_cash: countedCash,
            expected_cash: expectedCash,
            variance: variance,
            deposit_amount: countedCash,
            closed_at: new Date().toISOString(),
            notes: `Auto-closed by system at ${template.auto_close_time} (${template.name})`,
          })
          .eq('id', shift.id);

        if (closeError) {
          console.error(`Error closing shift ${shift.id}:`, closeError);
          continue;
        }

        closedCount++;
        console.log(`Closed shift ${shift.id} (${template.name})`);

        const cashSales = (cashEvents || [])
          .filter((e: any) => e.event_type === 'sale' && e.payment_method === 'cash')
          .reduce((sum: number, e: any) => sum + e.amount, 0);
        const cardSales = (cashEvents || [])
          .filter((e: any) => e.event_type === 'sale' && e.payment_method === 'card')
          .reduce((sum: number, e: any) => sum + e.amount, 0);
        const otherSales = (cashEvents || [])
          .filter((e: any) => e.event_type === 'sale' && e.payment_method === 'other')
          .reduce((sum: number, e: any) => sum + e.amount, 0);

        const totalShiftSales = cashSales + cardSales + otherSales;

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const salesTransactions: Array<{
          restaurant_id: string;
          shift_id: string;
          subtotal: number;
          tax: number;
          total: number;
          payment_method: 'cash' | 'card' | 'other';
          receipt_number: string;
        }> = [];

        if (cashSales > 0) {
          salesTransactions.push({
            restaurant_id: restaurant.id,
            shift_id: shift.id,
            subtotal: cashSales,
            tax: 0,
            total: cashSales,
            payment_method: 'cash',
            receipt_number: `AUTO-CASH-${dateStr}-${shift.id.slice(0, 8).toUpperCase()}`,
          });
        }

        if (cardSales > 0) {
          salesTransactions.push({
            restaurant_id: restaurant.id,
            shift_id: shift.id,
            subtotal: cardSales,
            tax: 0,
            total: cardSales,
            payment_method: 'card',
            receipt_number: `AUTO-CARD-${dateStr}-${shift.id.slice(0, 8).toUpperCase()}`,
          });
        }

        if (otherSales > 0) {
          salesTransactions.push({
            restaurant_id: restaurant.id,
            shift_id: shift.id,
            subtotal: otherSales,
            tax: 0,
            total: otherSales,
            payment_method: 'other',
            receipt_number: `AUTO-OTHER-${dateStr}-${shift.id.slice(0, 8).toUpperCase()}`,
          });
        }

        if (salesTransactions.length > 0) {
          const { error: saleError } = await db
            .from('sales_transactions')
            .insert(salesTransactions);

          if (!saleError) {
            salesCreatedCount += salesTransactions.length;
            console.log(`Created ${salesTransactions.length} sales transactions for shift ${shift.id}: Cash=${cashSales}, Card=${cardSales}, Other=${otherSales}`);
          } else {
            console.error(`Error creating sales transactions:`, saleError);
          }
        }

        results.push({
          action: 'closed',
          restaurant_id: restaurant.id,
          restaurant_name: restaurant.name,
          shift_id: shift.id,
          template_name: template.name,
          counted_cash: countedCash,
          expected_cash: expectedCash,
          variance: variance,
          sales_total: totalShiftSales,
        });

      } catch (shiftError) {
        console.error(`Error processing shift ${shift.id}:`, shiftError);
      }
    }

    // ========== AUTO-OPEN LOGIC ==========
    console.log('Checking for shifts to auto-open...');

    // Get all templates with auto_open_enabled and a default drawer configured
    const { data: autoOpenTemplates, error: templatesError } = await db
      .from('shift_templates')
      .select('id, name, restaurant_id, start_time, end_time, default_float, auto_open_enabled, default_cashier_staff_id, default_drawer_id')
      .eq('auto_open_enabled', true)
      .not('default_drawer_id', 'is', null);

    if (templatesError) {
      console.error('Error fetching auto-open templates:', templatesError);
    } else {
      console.log(`Found ${autoOpenTemplates?.length || 0} templates with auto-open enabled`);

      for (const template of autoOpenTemplates || []) {
        // Get restaurant timezone
        const { data: restaurant, error: restaurantError } = await db
          .from('restaurants')
          .select('id, name, timezone')
          .eq('id', template.restaurant_id)
          .single();

        if (restaurantError || !restaurant) {
          console.log(`Template ${template.name}: No restaurant found, skipping`);
          continue;
        }

        // Check if template has a default cashier configured
        if (!template.default_cashier_staff_id) {
          console.log(`Template ${template.name}: No default cashier configured, skipping`);
          continue;
        }

        // Get the staff member to find their user_id
        const { data: staffMember, error: staffError } = await db
          .from('staff')
          .select('id, name, user_id')
          .eq('id', template.default_cashier_staff_id)
          .single();

        if (staffError || !staffMember) {
          console.log(`Template ${template.name}: Could not find staff member, skipping`);
          continue;
        }

        let cashierUserId: string | null = staffMember.user_id;

        // If the staff member isn't linked to a login yet, fall back to the restaurant owner account
        // (still stores cashier_staff_id so reporting remains accurate)
        if (!cashierUserId) {
          const { data: ownerRole, error: ownerError } = await db
            .from('user_roles')
            .select('user_id')
            .eq('restaurant_id', restaurant.id)
            .eq('role', 'owner')
            .limit(1)
            .maybeSingle();

          if (ownerError || !ownerRole?.user_id) {
            console.log(
              `Template ${template.name}: Staff ${staffMember.name} has no linked user account and no owner account found, skipping`
            );
            continue;
          }

          cashierUserId = ownerRole.user_id;
          console.log(
            `Template ${template.name}: Staff ${staffMember.name} has no linked user account; using owner account to auto-open shift`
          );
        }

        const now = new Date();
        const timezone = restaurant.timezone || 'Asia/Riyadh';
        
        const localFormatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
        
        const localParts = localFormatter.formatToParts(now);
        const getPartValue = (type: string) => localParts.find(p => p.type === type)?.value || '';
        
        const currentDate = `${getPartValue('year')}-${getPartValue('month')}-${getPartValue('day')}`;
        const [currentHour, currentMinute] = [parseInt(getPartValue('hour')), parseInt(getPartValue('minute'))];
        const currentMinutes = currentHour * 60 + currentMinute;

        const [startHour, startMinute] = (template.start_time || '00:00:00')
          .split(':')
          .slice(0, 2)
          .map(Number);
        const startMinutes = startHour * 60 + startMinute;

        const [endHour, endMinute] = (template.end_time || '23:59:00')
          .split(':')
          .slice(0, 2)
          .map(Number);
        const endMinutes = endHour * 60 + endMinute;

        // Allow auto-open any time during the shift window (prevents missing a narrow start-time window)
        const isWithinShiftWindow = (() => {
          if (startMinutes === endMinutes) return currentMinutes >= startMinutes;
          if (endMinutes > startMinutes) return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
          // Overnight shift (e.g. 18:00 -> 02:00)
          return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
        })();

        if (!isWithinShiftWindow) {
          console.log(
            `Template ${template.name}: Not within shift window (start: ${template.start_time}, end: ${template.end_time}, current: ${getPartValue('hour')}:${getPartValue('minute')})`
          );
          continue;
        }

        console.log(`Template ${template.name}: Within auto-open window, checking default drawer...`);

        // Get the specific drawer configured for this template
        const { data: drawer, error: drawerError } = await db
          .from('drawers')
          .select('id, name')
          .eq('id', template.default_drawer_id)
          .eq('is_active', true)
          .single();

        if (drawerError || !drawer) {
          console.log(`Template ${template.name}: Default drawer not found or inactive`);
          continue;
        }

        // Check if drawer already has an open/closing shift
        const { data: existingShift, error: existingShiftError } = await db
          .from('shifts')
          .select('id')
          .eq('drawer_id', drawer.id)
          .in('status', ['open', 'closing'])
          .limit(1)
          .maybeSingle();

        if (existingShiftError) {
          console.error(`Error checking existing shift for drawer ${drawer.name}:`, existingShiftError);
          continue;
        }

        if (existingShift) {
          console.log(`Drawer ${drawer.name}: Already has open shift, skipping`);
          continue;
        }

        // Check if a shift was already opened *today (local restaurant day)* for this template + drawer
        const { startIso: localDayStartUtc, endIso: localDayEndUtc } = getLocalDayRangeUTC(timezone, now);

        const { data: todayShift, error: todayShiftError } = await db
          .from('shifts')
          .select('id')
          .eq('drawer_id', drawer.id)
          .eq('template_id', template.id)
          .gte('opened_at', localDayStartUtc)
          .lte('opened_at', localDayEndUtc)
          .limit(1);

        if (todayShiftError) {
          console.error(`Error checking today's shifts for drawer ${drawer.name}:`, todayShiftError);
          continue;
        }

        if (todayShift && todayShift.length > 0) {
          console.log(`Drawer ${drawer.name}: Already had a shift today for template ${template.name}, skipping`);
          continue;
        }

        // Open the shift (use linked cashier user when available, otherwise owner fallback)
        const { data: newShift, error: openError } = await db
          .from('shifts')
          .insert({
            restaurant_id: restaurant.id,
            drawer_id: drawer.id,
            template_id: template.id,
            cashier_user_id: cashierUserId,
            cashier_staff_id: staffMember.id,
            opening_float: template.default_float || 0,
            status: 'open',
            notes: `Auto-opened by system (${template.name}, cashier staff: ${staffMember.name})`,
          })
          .select('id')
          .single();

        if (openError) {
          console.error(`Error opening shift for drawer ${drawer.name}:`, openError);
          continue;
        }

        openedCount++;
        console.log(`Auto-opened shift ${newShift.id} for drawer ${drawer.name} (${template.name})`);

        results.push({
          action: 'opened',
          restaurant_id: restaurant.id,
          restaurant_name: restaurant.name,
          shift_id: newShift.id,
          drawer_name: drawer.name,
          template_name: template.name,
          opening_float: template.default_float || 0,
        });
      }
    }

    console.log(`Auto-shift manager completed. Closed ${closedCount} shifts, opened ${openedCount} shifts, created ${salesCreatedCount} sales transactions.`);

    return new Response(JSON.stringify({
      success: true,
      message: `Processed ${openShifts?.length || 0} open shifts, ${autoOpenTemplates?.length || 0} auto-open templates`,
      closed_shifts: closedCount,
      opened_shifts: openedCount,
      sales_created: salesCreatedCount,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Error in auto-shift-manager:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
