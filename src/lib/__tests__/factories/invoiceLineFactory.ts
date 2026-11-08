/**
 * Factory for invoice line inputs used by integration tests.
 *
 * Guarantees that `auto_create_purchase` is always present so callers never
 * hit "Property 'auto_create_purchase' is missing" TypeScript errors again.
 */

export interface InvoiceLineInput {
  inventory_item_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  auto_create_purchase: boolean;
}

const DEFAULTS: InvoiceLineInput = {
  inventory_item_id: null,
  description: "Test line item",
  quantity: 1,
  unit_price: 100,
  auto_create_purchase: false,
};

export function createLineInput(
  overrides: Partial<InvoiceLineInput> = {},
): InvoiceLineInput {
  return { ...DEFAULTS, ...overrides };
}

export function createLineInputs(
  count: number,
  overrides: Partial<InvoiceLineInput> = {},
): InvoiceLineInput[] {
  return Array.from({ length: count }, (_, i) =>
    createLineInput({
      description: `Test line item ${i + 1}`,
      ...overrides,
    }),
  );
}
