import "@/styles/landing-lux.css";

interface MarketingShellProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Shared canvas for every public marketing page (company, resources, legal).
 * Applies the shared emerald art direction and follows the active light/dark
 * preference across every public page.
 */
export function MarketingShell({ children, className = "" }: MarketingShellProps) {
  return (
    <div className={`lux min-h-screen flex flex-col bg-background text-foreground ${className}`}>
      {children}
    </div>
  );
}

export default MarketingShell;
