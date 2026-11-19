import { test } from "node:test";
import { deepStrictEqual as eq, ok } from "node:assert/strict";
import { buildDeliverectMenu, signForTest, verifyDeliverectSignature } from "./deliverect.ts";

test("menu: single-price items and sized items, VAT-inclusive halalas, 15% as 15000", () => {
  const { products, categories } = buildDeliverectMenu([
    { id: "a", name: "Burger", category: "Main", description: null, image_url: null, is_active: true, selling_price: 23, quarter_price: null, half_price: null, full_price: 23 },
    { id: "b", name: "Mandi", category: "Rice", description: "lamb", image_url: null, is_active: true, selling_price: 0, quarter_price: 25, half_price: 45, full_price: 85 },
    { id: "c", name: "Old", category: "Main", description: null, image_url: null, is_active: false, selling_price: 10, quarter_price: null, half_price: null, full_price: 10 },
  ], 0.15);
  eq(products.map((p) => [p.plu, p.price]), [["a", 2300], ["b:quarter", 2500], ["b:half", 4500], ["b:full", 8500]]);
  eq(products[0].deliveryTax, 15000);
  eq(categories, [{ posCategoryId: "main", name: "Main" }, { posCategoryId: "rice", name: "Rice" }]);
});

test("signature: production secret required; staging also accepts the location id", async () => {
  const body = JSON.stringify({ locationId: "loc-1" });
  process.env.DELIVERECT_ENV = "staging";
  delete process.env.DELIVERECT_WEBHOOK_SECRET;
  ok(await verifyDeliverectSignature(body, await signForTest("loc-1", body), ["loc-1"]));
  ok(!(await verifyDeliverectSignature(body, await signForTest("wrong", body), ["loc-1"])));
  ok(!(await verifyDeliverectSignature(body, null, ["loc-1"])));
  process.env.DELIVERECT_ENV = "production";
  process.env.DELIVERECT_WEBHOOK_SECRET = "prod-secret";
  ok(!(await verifyDeliverectSignature(body, await signForTest("loc-1", body), ["loc-1"])));
  ok(await verifyDeliverectSignature(body, await signForTest("prod-secret", body), ["loc-1"]));
  delete process.env.DELIVERECT_ENV;
  delete process.env.DELIVERECT_WEBHOOK_SECRET;
});
