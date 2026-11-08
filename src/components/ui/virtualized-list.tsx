import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";

interface VirtualizedListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  estimateSize?: number;
  overscan?: number;
  className?: string;
  itemKey?: (item: T, index: number) => string | number;
}

/**
 * Lightweight virtualized list using a self-scrolling container.
 * Use for long (>20 row) lists inside dialogs/drawers to keep
 * scroll performance smooth.
 */
export function VirtualizedList<T>({
  items,
  renderItem,
  estimateSize = 64,
  overscan = 6,
  className,
  itemKey,
}: VirtualizedListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: itemKey ? (i) => itemKey(items[i], i) : undefined,
  });

  return (
    <div
      ref={parentRef}
      className={cn("overflow-y-auto contain-strict", className)}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((vi) => (
          <div
            key={vi.key}
            data-index={vi.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${vi.start}px)`,
            }}
          >
            {renderItem(items[vi.index], vi.index)}
          </div>
        ))}
      </div>
    </div>
  );
}