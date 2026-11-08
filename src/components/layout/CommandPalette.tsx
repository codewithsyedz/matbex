import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Clock,
  Receipt,
  Package,
  BarChart3,
  Settings,
  Plus,
  Search,
  Database,
  MessageCircle,
  UtensilsCrossed,
  PieChart,
  CircleDollarSign,
  UserCog,
  Lock,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { hasFeature } = useAuth();

  const runCommand = (command: () => void) => {
    onOpenChange(false);
    command();
  };

  const handleLockedClick = (label: string) => {
    onOpenChange(false);
    toast.info(t("command.proFeature", { label }), {
      description: t("command.upgradeDescription"),
    });
  };

  // Define navigation items with feature gates
  const navItems = [
    { label: t("nav.dashboard"), icon: LayoutDashboard, path: "/dashboard" },
    { label: t("nav.shifts"), icon: Clock, path: "/shifts", featureKey: "shifts" },
    { label: t("nav.sales"), icon: Receipt, path: "/sales" },
    { label: t("nav.inventory"), icon: Package, path: "/inventory", featureKey: "inventory" },
    { label: t("nav.menu"), icon: UtensilsCrossed, path: "/menu", featureKey: "menu" },
    { label: t("nav.cogs"), icon: PieChart, path: "/cogs", featureKey: "cogs" },
    { label: t("nav.accounting"), icon: CircleDollarSign, path: "/accounting", featureKey: "accounting" },
    { label: t("nav.staff"), icon: UserCog, path: "/staff", featureKey: "payroll" },
    { label: t("nav.chat"), icon: MessageCircle, path: "/chat", featureKey: "chat" },
    { label: t("nav.reports"), icon: BarChart3, path: "/reports" },
  ];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={t("command.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("command.noResults")}</CommandEmpty>
        
        <CommandGroup heading={t("command.quickActions")}>
          {hasFeature("shifts") && (
            <CommandItem onSelect={() => runCommand(() => navigate("/shifts?action=new"))}>
              <Plus className="me-2 h-4 w-4" />
              <span>{t("command.openShift")}</span>
            </CommandItem>
          )}
          <CommandItem onSelect={() => runCommand(() => navigate("/sales?action=new"))}>
            <Receipt className="me-2 h-4 w-4" />
            <span>{t("command.recordTransaction")}</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => {})}>
            <Search className="me-2 h-4 w-4" />
            <span>{t("command.searchTransactions")}</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("command.navigation")}>
          {navItems.map((item) => {
            const isLocked = item.featureKey && !hasFeature(item.featureKey);
            
            if (isLocked) {
              return (
                <CommandItem 
                  key={item.path} 
                  onSelect={() => handleLockedClick(item.label)}
                  className="opacity-60"
                >
                  <item.icon className="me-2 h-4 w-4 opacity-50" />
                  <span className="flex-1">{item.label}</span>
                  <Lock className="h-3 w-3 me-1 opacity-50" />
                  <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">Pro</Badge>
                </CommandItem>
              );
            }
            
            return (
              <CommandItem key={item.path} onSelect={() => runCommand(() => navigate(item.path))}>
                <item.icon className="me-2 h-4 w-4" />
                <span>{item.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("nav.settings")}>
          <CommandItem onSelect={() => runCommand(() => navigate("/settings"))}>
            <Settings className="me-2 h-4 w-4" />
            <span>{t("nav.settings")}</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate("/settings?tab=backend"))}>
            <Database className="me-2 h-4 w-4" />
            <span>{t("command.backendConfiguration")}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
