// =====================================================================
// ZATCA field validation - pure, framework-agnostic.
// ---------------------------------------------------------------------
// Surfaces inline error messages for the buyer / discount / surcharge /
// foreign-currency fields on the Record-Sale form before we attempt to
// build the UBL XML. Kept as a pure function so it can be unit-tested
// in isolation and re-used (e.g. credit-note dialog).
// =====================================================================

export type BuyerIdScheme =
  | "CRN" | "NAT" | "IQA" | "GCC" | "PAS"
  | "MOM" | "MLS" | "SAG" | "OTH";

export interface ZatcaValidationInput {
  invoiceSubtype: "SIMPLIFIED" | "STANDARD";
  buyerName: string;
  buyerVat: string;
  buyerIdScheme: BuyerIdScheme;
  buyerIdValue: string;
  docDiscount: string;
  docSurcharge: string;
  docCurrency: string;
  docFxRate: string;
  cartTotal: number;
}

export type ZatcaValidationErrors = {
  buyerName?: string;
  buyerVat?: string;
  buyerIdValue?: string;
  docDiscount?: string;
  docSurcharge?: string;
  docFxRate?: string;
};

export function validateZatcaFields(
  input: ZatcaValidationInput,
): ZatcaValidationErrors {
  const errors: ZatcaValidationErrors = {};

  if (input.invoiceSubtype === "STANDARD") {
    const trimmedName = input.buyerName.trim();
    if (!trimmedName) {
      errors.buyerName =
        'Buyer name is required for Standard (B2B) invoices (e.g. "Acme Trading Co.").';
    } else if (trimmedName.length < 3) {
      errors.buyerName = "Buyer name must be at least 3 characters.";
    } else if (trimmedName.length > 1000) {
      errors.buyerName = "Buyer name must be 1000 characters or fewer.";
    }

    const vatRaw = input.buyerVat.trim();
    const idRaw = input.buyerIdValue.trim();
    const hasVat = /^\d{15}$/.test(vatRaw);
    const hasOtherId = idRaw.length > 0;

    if (vatRaw.length > 0) {
      if (!/^\d+$/.test(vatRaw)) {
        errors.buyerVat = "VAT number must contain digits only (no spaces or letters).";
      } else if (vatRaw.length !== 15) {
        errors.buyerVat = `VAT number must be exactly 15 digits (you entered ${vatRaw.length}).`;
      } else if (!vatRaw.startsWith("3") || !vatRaw.endsWith("3")) {
        errors.buyerVat = "ZATCA VAT numbers must start and end with the digit 3.";
      }
    } else if (!hasOtherId) {
      errors.buyerVat =
        "Provide a 15-digit VAT number, or a non-VAT buyer ID below (CRN, NAT, IQA, PAS, MOM, MLS, SAG, GCC, OTH).";
    }

    if (idRaw.length > 0) {
      if (!/^[A-Za-z0-9-]+$/.test(idRaw)) {
        errors.buyerIdValue =
          "Buyer ID may only contain letters, digits, and hyphens (no spaces).";
      } else if (idRaw.length > 50) {
        errors.buyerIdValue = "Buyer ID must be 50 characters or fewer.";
      } else {
        switch (input.buyerIdScheme) {
          case "CRN":
            if (!/^\d{10}$/.test(idRaw)) {
              errors.buyerIdValue = `CRN (Commercial Registration) must be exactly 10 digits (you entered ${idRaw.length}).`;
            }
            break;
          case "NAT":
            if (!/^1\d{9}$/.test(idRaw)) {
              errors.buyerIdValue = "Saudi National ID must be 10 digits and start with 1.";
            }
            break;
          case "IQA":
            if (!/^2\d{9}$/.test(idRaw)) {
              errors.buyerIdValue = "Iqama must be 10 digits and start with 2.";
            }
            break;
          case "GCC":
            if (!/^\d{8,15}$/.test(idRaw)) {
              errors.buyerIdValue = "GCC ID must be 8–15 digits.";
            }
            break;
          case "PAS":
            if (!/^[A-Z0-9]{6,12}$/.test(idRaw.toUpperCase())) {
              errors.buyerIdValue =
                "Passport number must be 6–12 letters/digits (e.g. A1234567).";
            }
            break;
          case "MOM":
          case "MLS":
          case "SAG":
            if (!/^[A-Z0-9-]{4,20}$/i.test(idRaw)) {
              errors.buyerIdValue = `${input.buyerIdScheme} license must be 4–20 letters/digits.`;
            }
            break;
          case "OTH":
            if (idRaw.length < 3) {
              errors.buyerIdValue =
                "Other ID must be at least 3 characters; pick a more specific scheme if possible.";
            }
            break;
        }
      }
    } else if (!hasVat) {
      errors.buyerIdValue =
        "Required when no VAT number is provided. Choose a scheme (CRN, NAT, IQA, PAS, MOM, MLS, SAG, GCC, or OTH) and enter the matching ID.";
    }
  }

  const discount = parseFloat(input.docDiscount);
  if (input.docDiscount.trim().length > 0) {
    if (!Number.isFinite(discount)) {
      errors.docDiscount =
        "Discount must be a number (e.g. 10 or 12.50 - use a dot for decimals).";
    } else if (discount < 0) {
      errors.docDiscount = "Discount must be zero or greater (no negative values).";
    } else if (Math.round(discount * 100) !== discount * 100) {
      errors.docDiscount =
        "Discount supports at most 2 decimal places (e.g. 12.50, not 12.505).";
    } else if (discount > input.cartTotal) {
      errors.docDiscount = `Discount cannot exceed the cart subtotal (${input.cartTotal.toFixed(2)} ${input.docCurrency || "SAR"}).`;
    }
  }

  const surcharge = parseFloat(input.docSurcharge);
  if (input.docSurcharge.trim().length > 0) {
    if (!Number.isFinite(surcharge)) {
      errors.docSurcharge =
        "Surcharge must be a number (e.g. 5 or 7.25 - use a dot for decimals).";
    } else if (surcharge < 0) {
      errors.docSurcharge = "Surcharge must be zero or greater (no negative values).";
    } else if (Math.round(surcharge * 100) !== surcharge * 100) {
      errors.docSurcharge =
        "Surcharge supports at most 2 decimal places (e.g. 7.25, not 7.255).";
    }
  }

  if (input.docCurrency && input.docCurrency !== "SAR") {
    const fx = parseFloat(input.docFxRate);
    if (input.docFxRate.trim().length === 0) {
      errors.docFxRate = `Exchange rate is required when invoicing in ${input.docCurrency} (e.g. 1 ${input.docCurrency} = 3.75000 SAR).`;
    } else if (!Number.isFinite(fx)) {
      errors.docFxRate =
        "Exchange rate must be a number (e.g. 3.75 - use a dot for decimals).";
    } else if (fx <= 0) {
      errors.docFxRate = "Exchange rate must be greater than zero.";
    } else if (Math.round(fx * 100000) !== fx * 100000) {
      errors.docFxRate =
        "Exchange rate supports at most 5 decimal places (e.g. 3.75000, not 3.755555).";
    } else if (fx > 1000) {
      errors.docFxRate =
        "Exchange rate looks unusually high (>1000 SAR per unit). Double-check the source/target direction.";
    }
  }

  return errors;
}