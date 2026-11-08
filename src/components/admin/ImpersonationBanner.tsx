import { useSuperAdmin } from "@/contexts/SuperAdminContext";
import { Button } from "@/components/ui/button";
import { X, Eye } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function ImpersonationBanner() {
  const { isSuperAdmin, isImpersonating, impersonatedTenant, stopImpersonation } = useSuperAdmin();
  const navigate = useNavigate();

  // Only show for SuperAdmins who are actively impersonating
  if (!isSuperAdmin || !isImpersonating || !impersonatedTenant) {
    return null;
  }

  const handleExit = () => {
    stopImpersonation();
    navigate("/admin/tenants");
  };

  return (
    <div className="bg-purple-600 text-white px-4 py-2">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4" />
          <span className="text-sm font-medium">
            Viewing as: <span className="font-semibold">{impersonatedTenant.name}</span>
          </span>
          <span className="text-xs opacity-75">
            (SuperAdmin Impersonation Mode)
          </span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="bg-white/20 hover:bg-white/30 text-white border-0"
          onClick={handleExit}
        >
          <X className="h-4 w-4 mr-1" />
          Exit View
        </Button>
      </div>
    </div>
  );
}
