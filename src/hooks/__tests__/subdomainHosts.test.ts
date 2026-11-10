import { test, expect } from "vitest";
import { extractTenantSubdomain, extractCustomDomain } from "@/hooks/useSubdomainTenant";
test("app hosts are never storefronts; restaurant subdomains are", () => {
  expect(extractTenantSubdomain("staging.matbex.com")).toBeNull();
  expect(extractTenantSubdomain("staging-api.matbex.com")).toBeNull();
  expect(extractTenantSubdomain("app.matbex.com")).toBeNull();
  expect(extractTenantSubdomain("pizzaplace.matbex.com")).toBe("pizzaplace");
  expect(extractCustomDomain("staging.matbex.com")).toBeNull();
});
