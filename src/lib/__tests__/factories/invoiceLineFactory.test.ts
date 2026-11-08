import { describe, expect, it } from "vitest";
import {
  createLineInput,
  createLineInputs,
  type InvoiceLineInput,
} from "./invoiceLineFactory";

describe("invoiceLineFactory", () => {
  describe("createLineInput", () => {
    it("returns a complete InvoiceLineInput with defaults", () => {
      const line = createLineInput();

      expect(line).toEqual({
        inventory_item_id: null,
        description: "Test line item",
        quantity: 1,
        unit_price: 100,
        auto_create_purchase: false,
      });
    });

    it("always includes auto_create_purchase even with no overrides", () => {
      const line = createLineInput();

      expect(Object.keys(line)).toContain("auto_create_purchase");
      expect(typeof line.auto_create_purchase).toBe("boolean");
    });

    it("applies overrides while preserving auto_create_purchase", () => {
      const line = createLineInput({
        inventory_item_id: "inv-123",
        description: "Custom item",
        quantity: 5,
        unit_price: 24.5,
      });

      expect(line).toEqual({
        inventory_item_id: "inv-123",
        description: "Custom item",
        quantity: 5,
        unit_price: 24.5,
        auto_create_purchase: false,
      });
    });

    it("allows auto_create_purchase to be overridden to true", () => {
      const line = createLineInput({ auto_create_purchase: true });

      expect(line.auto_create_purchase).toBe(true);
    });

    it("produces a correctly typed InvoiceLineInput payload", () => {
      const line = createLineInput();

      // Type-level assertion: if this compiles, the shape is correct.
      const typed: InvoiceLineInput = line;
      expect(typed.inventory_item_id).toBeNull();
      expect(typed.description).toBe("Test line item");
      expect(typed.quantity).toBe(1);
      expect(typed.unit_price).toBe(100);
      expect(typed.auto_create_purchase).toBe(false);
    });

  });

  describe("createLineInputs", () => {
    it("creates the requested number of line inputs", () => {
      const lines = createLineInputs(3);

      expect(lines).toHaveLength(3);
    });

    it("auto-increments descriptions for each line", () => {
      const lines = createLineInputs(3);

      expect(lines[0].description).toBe("Test line item 1");
      expect(lines[1].description).toBe("Test line item 2");
      expect(lines[2].description).toBe("Test line item 3");
    });

    it("applies shared overrides to every generated line", () => {
      const lines = createLineInputs(2, {
        inventory_item_id: "shared-inv",
        unit_price: 50,
        auto_create_purchase: true,
      });

      for (const line of lines) {
        expect(line.inventory_item_id).toBe("shared-inv");
        expect(line.unit_price).toBe(50);
        expect(line.auto_create_purchase).toBe(true);
      }
    });

    it("every generated line includes auto_create_purchase", () => {
      const lines = createLineInputs(5);

      expect(lines.every((line) => "auto_create_purchase" in line)).toBe(true);
    });

    it("produces correctly typed InvoiceLineInput payloads in bulk", () => {
      const lines: InvoiceLineInput[] = createLineInputs(2);

      expect(lines).toHaveLength(2);
      lines.forEach((line) => {
        expect(typeof line.auto_create_purchase).toBe("boolean");
      });
    });
  });
});
