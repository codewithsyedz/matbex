import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/db/client", () => ({ db: { rpc } }));

import { loadPlaced, savePlaced, useGuestOrderStatus } from "../useGuestOrderStatus";

const order = { id: "o1", access_token: "t1" };

describe("useGuestOrderStatus", () => {
  beforeEach(() => rpc.mockReset());
  afterEach(() => sessionStorage.clear());

  it("asks with the order's token and polls until staff decide", async () => {
    rpc
      .mockResolvedValueOnce({ data: { found: true, status: "submitted" } })
      .mockResolvedValueOnce({ data: { found: true, status: "accepted" } });
    const { result } = renderHook(() => useGuestOrderStatus(order, 5));
    await waitFor(() => expect(result.current?.status).toBe("accepted"));
    expect(rpc).toHaveBeenCalledWith("guest_get_order", { p_id: "o1", p_token: "t1" });
    await new Promise((r) => setTimeout(r, 30));
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("shows the reason of a rejected order", async () => {
    rpc.mockResolvedValueOnce({ data: { found: true, status: "cancelled", reject_reason: "Kitchen closed" } });
    const { result } = renderHook(() => useGuestOrderStatus(order, 5));
    await waitFor(() => expect(result.current?.reject_reason).toBe("Kitchen closed"));
  });

  it("does nothing without an order", () => {
    const { result } = renderHook(() => useGuestOrderStatus(null));
    expect(result.current).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("remembers the placed order per table for the tab", () => {
    savePlaced("T1", order);
    expect(loadPlaced("T1")).toEqual(order);
    expect(loadPlaced("T2")).toBeNull();
    savePlaced("T1", null);
    expect(loadPlaced("T1")).toBeNull();
  });
});
