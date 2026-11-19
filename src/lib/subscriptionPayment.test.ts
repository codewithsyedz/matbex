import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_PRICES, verifiedPaidPlan } from "../../server/functions/_shared/subscriptionPayment";

const session = { status: "complete", payment_status: "paid", mode: "subscription", metadata: { tenant_id: "tenant-a", user_id: "owner-a", plan_name: "starter" } };
const price = SUBSCRIPTION_PRICES.starter.id;
describe("Starter subscription verification", () => {
  it("charges 149 SAR per month", () => expect(SUBSCRIPTION_PRICES.starter.amount).toBe(14900));
  it("accepts a paid active Starter subscription", () => expect(verifiedPaidPlan(session, "tenant-a", "owner-a", price, "active")).toBe("starter"));
  it("rejects another tenant's checkout", () => expect(() => verifiedPaidPlan(session, "tenant-b", "owner-a", price, "active")).toThrow());
  it("rejects another owner's checkout", () => expect(() => verifiedPaidPlan(session, "tenant-a", "owner-b", price, "active")).toThrow());
  it("rejects unpaid sessions", () => expect(() => verifiedPaidPlan({ ...session, payment_status: "unpaid" }, "tenant-a", "owner-a", price, "active")).toThrow());
  it("rejects unknown prices", () => expect(() => verifiedPaidPlan(session, "tenant-a", "owner-a", "price_unknown", "active")).toThrow());
  it("rejects canceled subscriptions", () => expect(() => verifiedPaidPlan(session, "tenant-a", "owner-a", price, "canceled")).toThrow());
});