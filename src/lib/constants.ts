// Restaurant start date - all calculations should use this as the minimum date
export const RESTAURANT_START_DATE = new Date(2025, 11, 13); // December 13, 2025

// Get the effective start date for calculations (whichever is later: restaurant start or period start)
export function getEffectiveStartDate(periodStart: Date): Date {
  return periodStart < RESTAURANT_START_DATE ? RESTAURANT_START_DATE : periodStart;
}

// Calculate the number of operational days between two dates, respecting the restaurant start date
export function getOperationalDays(from: Date, to: Date): number {
  const effectiveFrom = getEffectiveStartDate(from);
  const effectiveTo = to < RESTAURANT_START_DATE ? RESTAURANT_START_DATE : to;
  
  if (effectiveFrom > effectiveTo) return 0;
  
  const diffTime = effectiveTo.getTime() - effectiveFrom.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end days
  return Math.max(1, diffDays);
}

// Check if a date is before the restaurant started
export function isBeforeRestaurantStart(date: Date): boolean {
  return date < RESTAURANT_START_DATE;
}

// Get days since restaurant opened (for daily overhead calculations)
export function getDaysSinceOpening(): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (today < RESTAURANT_START_DATE) return 0;
  
  const diffTime = today.getTime() - RESTAURANT_START_DATE.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

// Get the current month's operational days up to today (respecting start date)
export function getCurrentMonthOperationalDays(): number {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  return getOperationalDays(monthStart, today);
}

// Get the full month's operational days for a given date (Dec 13-31 for December 2025, full month for others)
export function getFullMonthOperationalDays(date?: Date): number {
  const targetDate = date || new Date();
  const monthStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
  const monthEnd = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0); // Last day of month
  return getOperationalDays(monthStart, monthEnd);
}

// Get the prorated daily overhead amount (monthly_amount / days_in_month)
// This gives the true daily cost regardless of restaurant start date
export function getProratedDailyOverhead(monthlyAmount: number, date?: Date): number {
  const targetDate = date || new Date();
  const daysInMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
  return monthlyAmount / daysInMonth;
}
