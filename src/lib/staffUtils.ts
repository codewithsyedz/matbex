import { format } from "date-fns";

interface StaffRecord {
  id?: string;
  full_name?: string | null;
  monthly_salary: number | null;
  hourly_rate: number | null;
  joined_date?: string;
  termination_date?: string | null;
  is_active?: boolean;
}

/**
 * Filters staff who were active during a specific date range.
 * For versioned overhead calculations:
 * - Staff is included if they joined before or during the period
 * - Staff is included if they're still active OR terminated after the period end
 * 
 * This ensures historical data remains unchanged when staff resigns.
 */
export function filterStaffActiveInPeriod(
  staffList: StaffRecord[],
  periodStart: Date,
  periodEnd: Date
): StaffRecord[] {
  const startStr = format(periodStart, "yyyy-MM-dd");
  const endStr = format(periodEnd, "yyyy-MM-dd");

  return staffList.filter((staff) => {
    // Staff must have joined before or during the period
    const joinedDate = staff.joined_date || "1900-01-01";
    if (joinedDate > endStr) {
      return false; // Staff joined after the period - exclude
    }

    // If staff has no termination date, they're currently active
    if (!staff.termination_date) {
      return true;
    }

    // Staff is included if they were terminated after the period started
    // (i.e., they were active for at least part of the period)
    return staff.termination_date >= startStr;
  });
}

/**
 * Calculate monthly payroll for a list of staff
 * Hourly staff: estimate 160 hours/month
 */
export function calculateMonthlyPayroll(staffList: StaffRecord[]): number {
  return staffList.reduce((sum, staff) => {
    const salary = Number(staff.monthly_salary) || 0;
    const hourlyEstimate = Number(staff.hourly_rate) * 160 || 0;
    return sum + (salary > 0 ? salary : hourlyEstimate);
  }, 0);
}

/**
 * Check if viewing current/future dates (use current active staff)
 * vs historical dates (use versioned staff based on termination_date)
 */
export function isCurrentPeriod(periodEnd: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(periodEnd);
  endDate.setHours(0, 0, 0, 0);
  return endDate >= today;
}
