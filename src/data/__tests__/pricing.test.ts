import { describe, expect, it } from "vitest";
import { PLAN_PRICES_SAR, annualTotalSar, annualMonthlySar } from "../pricing";

describe("plan prices", () => {
  it("monthly SAR prices", () => {
    expect(PLAN_PRICES_SAR.starter.monthly).toBe(149);
    expect(PLAN_PRICES_SAR.growth.monthly).toBe(349);
    expect(PLAN_PRICES_SAR.enterprise.monthly).toBe(699);
  });
  it("ZATCA only in Growth (Pro) and Enterprise", () => {
    expect(PLAN_PRICES_SAR.starter.zatca).toBe(false);
    expect(PLAN_PRICES_SAR.growth.zatca).toBe(true);
    expect(PLAN_PRICES_SAR.enterprise.zatca).toBe(true);
  });
  it("annual = 2 months free", () => {
    expect(annualTotalSar("growth")).toBe(3490);
    expect(annualMonthlySar("starter")).toBe(124);
  });
});
