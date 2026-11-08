import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MigrationWizard } from "@/components/migration/MigrationWizard";
import { useAuth } from "@/contexts/AuthContext";

export default function MigrationPage() {
  const { hasRole, loading } = useAuth() as any;
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!hasRole("owner") && !hasRole("manager")) {
      navigate("/dashboard", { replace: true });
    }
  }, [loading, hasRole, navigate]);

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Migration assistant</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Move your menu, inventory, customers, and staff from your old POS to Matbex safely.
        </p>
      </header>
      <MigrationWizard />
    </div>
  );
}