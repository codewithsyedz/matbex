import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager, useMutation, type MutationOptions } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * POS sale mutations queue the sale themselves when the device is offline. React Query's
 * default networkMode ("online") pauses a mutation while the browser reports offline, so the
 * mutation function, and with it the offline queue, never ran: the Pay button stayed on
 * "Processing…" and the sale was neither recorded nor queued. They must use "always".
 */
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

function run(options: Partial<MutationOptions>) {
  const fn = vi.fn(async () => "queued");
  const { result } = renderHook(() => useMutation({ mutationFn: fn, ...options }), { wrapper });
  act(() => result.current.mutate());
  return { fn, result };
}

describe("POS sale mutations while the browser reports offline", () => {
  afterEach(() => onlineManager.setOnline(true));

  it("the default networkMode pauses the mutation (the bug)", async () => {
    onlineManager.setOnline(false);
    const { fn, result } = run({});
    await waitFor(() => expect(result.current.isPaused).toBe(true));
    expect(fn).not.toHaveBeenCalled();
  });

  it('networkMode "always" runs it, so the sale reaches the offline queue', async () => {
    onlineManager.setOnline(false);
    const { fn, result } = run({ networkMode: "always" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["src/pages/RecordSale.tsx", "const recordSaleMutation = useMutation({"],
    ["src/pages/RecordSaleMobile.tsx", "const submit = useMutation({"],
    ["src/components/pos/SalesRecorder.tsx", "const recordSaleMutation = useMutation({"],
  ])("%s declares networkMode: \"always\" on its sale mutation", (file, decl) => {
    const src = readFileSync(resolve(process.cwd(), file), "utf8");
    const start = src.indexOf(decl);
    expect(start).toBeGreaterThan(-1);
    // Within the mutation's options, before mutationFn.
    const head = src.slice(start, src.indexOf("mutationFn", start));
    expect(head).toContain('networkMode: "always"');
  });
});
