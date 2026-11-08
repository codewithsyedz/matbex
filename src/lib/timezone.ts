import { subDays } from "date-fns";

// Timezone helpers (no extra deps)
// Computes UTC bounds for a restaurant-local calendar day.


export function getZonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const map = new Map(parts.map((p) => [p.type, p.value] as const));

  return {
    year: Number(map.get("year")),
    month: Number(map.get("month")),
    day: Number(map.get("day")),
    hour: Number(map.get("hour")),
    minute: Number(map.get("minute")),
    second: Number(map.get("second")),
  };
}

// Offset (ms) between provided UTC instant and the same instant represented in target timezone.
export function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const p = getZonedParts(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - date.getTime();
}

export function formatZonedYMD(date: Date, timeZone: string) {
  const p = getZonedParts(date, timeZone);
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return `${p.year}-${mm}-${dd}`;
}

export function getRestaurantDayBoundsUTC(date: Date, timeZone: string) {
  const p = getZonedParts(date, timeZone);

  // Local midnight expressed as if it were UTC (a "wall clock" UTC)
  const localMidnightAsUTC = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);

  // Convert local midnight -> true UTC by subtracting timezone offset at that moment
  const guess = new Date(localMidnightAsUTC);
  const offset = getTimeZoneOffsetMs(guess, timeZone);
  const startUtcMs = localMidnightAsUTC - offset;

  // Next local midnight
  const nextGuess = new Date(startUtcMs + 36 * 60 * 60 * 1000); // safe next-day guess
  const nextParts = getZonedParts(nextGuess, timeZone);
  const nextLocalMidnightAsUTC = Date.UTC(nextParts.year, nextParts.month - 1, nextParts.day, 0, 0, 0);
  const nextOffset = getTimeZoneOffsetMs(new Date(nextLocalMidnightAsUTC), timeZone);
  const endExclusiveUtcMs = nextLocalMidnightAsUTC - nextOffset;

  return {
    start: new Date(startUtcMs),
    endExclusive: new Date(endExclusiveUtcMs),
  };
}

/** UTC noon Date that corresponds to the current calendar date in the tenant timezone.
 *  Useful for defaulting dashboard date pickers without relying on the browser timezone. */
export function getTenantTodayDate(timeZone: string) {
  return new Date(`${formatZonedYMD(new Date(), timeZone)}T12:00:00Z`);
}

/** UTC noon Date that corresponds to yesterday in the tenant timezone. */
export function getTenantYesterdayDate(timeZone: string) {
  return subDays(getTenantTodayDate(timeZone), 1);
}

