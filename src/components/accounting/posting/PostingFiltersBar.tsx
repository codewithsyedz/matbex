import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  emptyPostingFilters,
  PostingFilterState,
  REASON_FILTER_OPTIONS,
} from "./postingFilters";

interface Props {
  value: PostingFilterState;
  onChange: (v: PostingFilterState) => void;
  branchPinned?: boolean;
}

export function PostingFiltersBar({ value, onChange, branchPinned }: Props) {
  const { profile, restaurant } = useAuth();
  const tenantId = profile?.tenant_id;
  const restaurantId = restaurant?.id;

  const { data: branches = [] } = useQuery({
    queryKey: ["posting-filter-branches", restaurantId],
    enabled: !!restaurantId && !branchPinned,
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("branches")
        .select("id, name")
        .eq("restaurant_id", restaurantId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
    staleTime: 5 * 60_000,
  });

  const { data: shifts = [] } = useQuery({
    queryKey: ["posting-filter-shifts", restaurantId, value.branchId, value.dateFrom, value.dateTo],
    enabled: !!restaurantId,
    queryFn: async () => {
      let q = (db as any)
        .from("shifts")
        .select("id, opened_at, closed_at, branch_id")
        .eq("restaurant_id", restaurantId)
        .order("opened_at", { ascending: false })
        .limit(50);
      if (value.branchId !== "all") q = q.eq("branch_id", value.branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        opened_at: string;
        closed_at: string | null;
        branch_id: string | null;
      }>;
    },
    staleTime: 60_000,
  });

  const set = (patch: Partial<PostingFilterState>) =>
    onChange({ ...value, ...patch });

  const dirty =
    value.search !== "" ||
    value.reasonCode !== "all" ||
    value.branchId !== "all" ||
    value.shiftId !== "all" ||
    value.dateFrom !== null ||
    value.dateTo !== null;

  return (
    <div className="rounded-md border bg-card p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Search description, account, branch…"
            className="pl-7 h-9"
          />
        </div>

        <Select value={value.reasonCode} onValueChange={(v) => set({ reasonCode: v })}>
          <SelectTrigger className="w-[170px] h-9">
            <SelectValue placeholder="Reason" />
          </SelectTrigger>
          <SelectContent>
            {REASON_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!branchPinned && (
          <Select value={value.branchId} onValueChange={(v) => set({ branchId: v, shiftId: "all" })}>
            <SelectTrigger className="w-[170px] h-9">
              <SelectValue placeholder="Store" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stores</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={value.shiftId} onValueChange={(v) => set({ shiftId: v })}>
          <SelectTrigger className="w-[200px] h-9">
            <SelectValue placeholder="Shift" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All shifts</SelectItem>
            {shifts.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {new Date(s.opened_at).toLocaleString()}{" "}
                {s.closed_at ? "(closed)" : "(open)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="date"
          value={value.dateFrom ?? ""}
          onChange={(e) => set({ dateFrom: e.target.value || null })}
          className="w-[140px] h-9"
          aria-label="Date from"
        />
        <span className="text-muted-foreground text-xs">→</span>
        <Input
          type="date"
          value={value.dateTo ?? ""}
          onChange={(e) => set({ dateTo: e.target.value || null })}
          className="w-[140px] h-9"
          aria-label="Date to"
        />

        {dirty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(emptyPostingFilters)}
            className="h-9"
          >
            <X className="h-3.5 w-3.5 mr-1" /> Reset
          </Button>
        )}
      </div>
    </div>
  );
}