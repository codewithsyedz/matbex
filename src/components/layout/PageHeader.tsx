import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Rendered inline next to the title (badges, status pills). */
  badges?: ReactNode;
  /** Right-aligned action buttons. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Canonical page header — matches the VAT Return page exactly:
 * 2xl light title, inline badges, muted description, right-aligned
 * actions, and a fixed minimum height so headers never jump between
 * routes that do or don't have a description.
 */
export function PageHeader({ title, description, badges, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex min-h-[56px] flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-[240px] flex-1">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">{title}</h1>
          {badges}
        </div>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
