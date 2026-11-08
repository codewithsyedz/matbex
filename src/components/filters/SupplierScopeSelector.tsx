import { useQuery } from "@tanstack/react-query";
import { Truck } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Supplier scope picker shared by the profit dashboards. "all" keeps the
 * existing behaviour; a supplier id narrows expense-driven costs to that
 * supplier so per-supplier cost and profit can be reviewed.
 */
export function SupplierScopeSelector({ value, onChange, className }: Props) {
  const { restaurant } = useAuth();

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers-active", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [] as Array<{ id: string; name: string }>;
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name, is_active")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as Array<{ id: string; name: string }>;
    },
    enabled: !!restaurant?.id,
    staleTime: 5 * 60_000,
  });

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? "w-[180px]"}>
        <Truck className="mr-2 h-4 w-4 text-muted-foreground" />
        <SelectValue placeholder="All suppliers" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All suppliers</SelectItem>
        <SelectItem value="none">No supplier</SelectItem>
        {suppliers.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
