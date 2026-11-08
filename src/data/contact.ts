// Canonical Matbex contact details.
// Used by the landing footer, the contact section, and company pages so the
// details live in one place. Update a value here and it propagates everywhere.
//
// TODO(operator): set CONTACT_PHONE to the real business phone number once
// confirmed — it is intentionally left empty so a placeholder never shows live.

export const CONTACT: {
  email: string;
  phone: string;
  address: string;
  careersEmail: string;
  pressEmail: string;
} = {
  email: "hello@matbex.com",
  /** Leave empty ("") until the real number is confirmed; UI hides the phone line when empty. */
  phone: "",
  address: "Riyadh, Saudi Arabia",
  careersEmail: "careers@matbex.com",
  pressEmail: "press@matbex.com",
};
