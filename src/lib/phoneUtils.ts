/**
 * Phone-number formatter / validator for E.164 WhatsApp/SMS inputs.
 *
 * Supports:
 *   • Saudi Arabia: 05xxxxxxxxx → +9665xxxxxxxx, 9665… → +9665…
 *   • Generic: anything starting with + is cleaned and length-checked.
 *   • Auto-prepends `+` when the user clearly entered a country code.
 *
 * Returns an object with the normalized value and a human-readable error,
 * or { error: null } when the number is valid.
 */

export interface PhoneResult {
  /** Cleaned E.164 value (e.g. "+966555123456") */
  value: string;
  /** Human-readable error message, or null when valid */
  error: string | null;
  /** True when the raw input was modified during normalization */
  formatted: boolean;
}

const SA_LOCAL = /^0(5\d{8})$/; // 05xxxxxxxx
const SA_SHORT_CC = /^(966)(5\d{8})$/; // 9665xxxxxxxx
const GENERIC_WITH_PLUS = /^\+([1-9]\d{6,14})$/;
const DIGITS_ONLY = /^(\+?\d+)$/;

/** Maximum length for the digits part of an E.164 number (ITU-T E.164). */
const MAX_CC_NSN_LEN = 15;

/** Minimum digits after the `+` sign. */
const MIN_NSN_LEN = 7;

/**
 * Normalize and validate a raw phone input.
 *
 * @param raw     The user-typed string.
 * @param region  Optional 2-letter country code hint (default "SA" for Saudi Arabia).
 */
export function normalizePhone(raw: string, region = "SA"): PhoneResult {
  const input = raw.trim();

  if (!input) {
    return { value: "", error: "Enter a phone number", formatted: false };
  }

  // Remove common separators, but keep the leading + if present.
  let digits = input.replace(/[\s\-.]/g, "");

  // If the user typed something that isn't digits or +, reject early.
  if (!DIGITS_ONLY.test(digits)) {
    return {
      value: digits,
      error: "Only digits and a leading + are allowed",
      formatted: false,
    };
  }

  let formatted = false;

  // Saudi-specific auto-corrections
  if (region === "SA") {
    if (SA_LOCAL.test(digits)) {
      digits = digits.replace(SA_LOCAL, "+966$1");
      formatted = true;
    } else if (SA_SHORT_CC.test(digits)) {
      digits = digits.replace(SA_SHORT_CC, "+$1$2");
      formatted = true;
    }
  }

  // If it still lacks a +, try to infer from the leading digits.
  if (!digits.startsWith("+")) {
    // Heuristic: if the first digits look like a known country code, prepend +.
    if (/^966/.test(digits)) {
      digits = `+${digits}`;
      formatted = true;
    } else if (/^1\d{10}$/.test(digits)) {
      // US/Canada 10-digit after 1
      digits = `+${digits}`;
      formatted = true;
    } else {
      return {
        value: digits,
        error: "Missing country code. Start with + or enter a local number (e.g. 05xxxxxxxx for Saudi Arabia)",
        formatted: false,
      };
    }
  }

  // Validate E.164 length
  const nsn = digits.slice(1); // drop the +
  if (nsn.length < MIN_NSN_LEN) {
    return {
      value: digits,
      error: `Too short (${nsn.length} digits). Minimum is ${MIN_NSN_LEN} after the country code.`,
      formatted,
    };
  }
  if (nsn.length > MAX_CC_NSN_LEN) {
    return {
      value: digits,
      error: `Too long (${nsn.length} digits). Maximum is ${MAX_CC_NSN_LEN} after the country code.`,
      formatted,
    };
  }

  // Country-specific length checks
  if (region === "SA" && digits.startsWith("+966")) {
    if (nsn.length !== 12) {
      return {
        value: digits,
        error: `Saudi mobile numbers must be 12 digits total (+966 + 9 digits). You have ${nsn.length} digits after +.`,
        formatted,
      };
    }
    const prefix = nsn.slice(3); // drop 966
    if (!/^5/.test(prefix)) {
      return {
        value: digits,
        error: "Saudi mobile numbers must start with +9665…",
        formatted,
      };
    }
  }

  return { value: digits, error: null, formatted };
}

/**
 * Pretty-format an E.164 number for display (read-only).
 * Example: +966555123456 → +966 55 512 3456
 */
export function formatPhoneDisplay(e164: string): string {
  if (!e164.startsWith("+")) return e164;

  if (e164.startsWith("+966")) {
    // +966 55 512 3456
    const rest = e164.slice(4);
    if (rest.length === 9) {
      return `+966 ${rest.slice(0, 2)} ${rest.slice(2, 5)} ${rest.slice(5)}`;
    }
    return `+966 ${rest}`;
  }

  // Generic: group in 3s from the right
  const nsn = e164.slice(1);
  const groups: string[] = [];
  let i = nsn.length;
  while (i > 0) {
    const start = Math.max(0, i - 3);
    groups.unshift(nsn.slice(start, i));
    i = start;
  }
  return `+${groups.join(" ")}`;
}
