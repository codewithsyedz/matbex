import { useState, useMemo } from "react";
import { Building2, LayoutDashboard, Settings, LogOut, Webhook, ScrollText, ShieldAlert, ShieldCheck, MessageSquare, BarChart3, CreditCard, FileText, ClipboardList, Flag, KeyRound, Laptop, Globe, Globe2, BookOpen, Search, Package, DollarSign, Coins, ChevronDown, Maximize2, Minimize2, Activity, Inbox, Mail, AlertTriangle } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { MatbexLogo } from "@/components/brand/MatbexLogo";

const navGroups = [
  {
    label: "Overview",
    items: [
      { title: "Overview", icon: LayoutDashboard, path: "/admin" },
    ],
  },
  {
    label: "Tenants",
    items: [
      { title: "Applications", icon: ClipboardList, path: "/admin/applications" },
      { title: "Tenants", icon: Building2, path: "/admin/tenants" },
      { title: "Tenant Costs", icon: DollarSign, path: "/admin/tenant-costs" },
    ],
  },
  {
    label: "Domains",
    items: [
      { title: "Subdomains", icon: Globe, path: "/admin/subdomains" },
      { title: "Custom Domains", icon: Globe2, path: "/admin/custom-domains" },
    ],
  },
  {
    label: "Billing & Plans",
    items: [
      { title: "Plans", icon: CreditCard, path: "/admin/plans" },
      { title: "Addons", icon: Package, path: "/admin/addons" },
      { title: "Currencies", icon: Coins, path: "/admin/currencies" },
    ],
  },
  {
    label: "Platform",
    items: [
      { title: "Devices", icon: Laptop, path: "/admin/devices" },
      { title: "Feature Flags", icon: Flag, path: "/admin/feature-flags" },
    ],
  },
  {
    label: "Content",
    items: [
      { title: "Landing CMS", icon: FileText, path: "/admin/landing-cms" },
      { title: "SEO", icon: Search, path: "/admin/seo" },
      { title: "Contact Messages", icon: Inbox, path: "/admin/contact-messages" },
      { title: "Email Inbox", icon: Mail, path: "/admin/email-inbox" },
      { title: "Enquiry Analytics", icon: BarChart3, path: "/admin/enquiries" },
      { title: "Visitor Traffic", icon: BarChart3, path: "/admin/traffic" },
      { title: "Lead Sources", icon: BarChart3, path: "/admin/lead-sources" },
    ],
  },
  {
    label: "Chat",
    items: [
      { title: "Chat Moderation", icon: MessageSquare, path: "/admin/chat-moderation" },
      { title: "Chat Analytics", icon: BarChart3, path: "/admin/chat-analytics" },
    ],
  },
  {
    label: "Security & Audit",
    items: [
      { title: "Security", icon: ShieldAlert, path: "/admin/security" },
      { title: "SuperAdmin Audit", icon: ShieldCheck, path: "/admin/superadmin-audit" },
      { title: "Tenant Audit Logs", icon: ScrollText, path: "/admin/audit" },
      { title: "Residency Audit", icon: Globe, path: "/admin/residency-audit" },
      { title: "Password Reset", icon: KeyRound, path: "/admin/password-reset" },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Webhooks", icon: Webhook, path: "/admin/webhooks" },
      { title: "Edge Function Health", icon: Activity, path: "/admin/edge-health" },
      { title: "Sync Health", icon: Activity, path: "/admin/sync-health" },
      { title: "Dead-Letter Queue", icon: AlertTriangle, path: "/admin/dlq" },
      { title: "Release Notes", icon: ScrollText, path: "/admin/release-notes" },
      { title: "KSA Setup", icon: BookOpen, path: "/admin/ksa-setup" },
      { title: "Settings", icon: Settings, path: "/admin/settings" },
    ],
  },
];

export function AdminSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, profile } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const activeGroupLabel = useMemo(() => {
    return navGroups.find((g) => g.items.some((i) => i.path === location.pathname))?.label ?? null;
  }, [location.pathname]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    navGroups.forEach((g) => {
      initial[g.label] = g.label === activeGroupLabel || g.label === "Overview";
    });
    return initial;
  });

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const expandAll = () => {
    const allOpen: Record<string, boolean> = {};
    navGroups.forEach((g) => {
      allOpen[g.label] = true;
    });
    setOpenGroups(allOpen);
  };

  const collapseAll = () => {
    const allClosed: Record<string, boolean> = {};
    navGroups.forEach((g) => {
      allClosed[g.label] = false;
    });
    setOpenGroups(allClosed);
  };

  const allExpanded = navGroups.every((g) => openGroups[g.label]);
  const allCollapsed = navGroups.every((g) => !openGroups[g.label]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  return (
    <Sidebar className="border-r border-border/40">
      <SidebarHeader className="border-b border-border/40 px-4 py-4">
        <div className="flex items-center gap-3">
          <MatbexLogo size="sm" showWordmark={false} animate={false} />
          <div className="flex flex-col">
            <span className="text-[15px] font-semibold text-foreground leading-[1.35]">SuperAdmin</span>
            <span className="text-[13px] text-muted-foreground leading-[1.4]">Platform Management</span>
          </div>
        </div>

        {!collapsed && (
          <div className="flex items-center gap-2 mt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={expandAll}
              disabled={allExpanded}
              className="h-7 px-2 text-[13px] text-muted-foreground hover:text-foreground leading-[1.4]"
            >
              <Maximize2 className="h-3 w-3 mr-1" />
              Expand all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={collapseAll}
              disabled={allCollapsed}
              className="h-7 px-2 text-[13px] text-muted-foreground hover:text-foreground leading-[1.4]"
            >
              <Minimize2 className="h-3 w-3 mr-1" />
              Collapse all
            </Button>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className="gap-0">
        {navGroups.map((group) => (
          <Collapsible
            key={group.label}
            open={openGroups[group.label] ?? false}
            onOpenChange={() => toggleGroup(group.label)}
          >
            <SidebarGroup className="py-0">
              <CollapsibleTrigger asChild>
                <SidebarGroupLabel className="text-[13px] font-medium text-muted-foreground/80 cursor-pointer flex items-center justify-between w-full pr-2 hover:text-muted-foreground transition-colors leading-[1.4]">
                  <span>{group.label}</span>
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${openGroups[group.label] ? "rotate-180" : ""}`}
                  />
                </SidebarGroupLabel>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => {
                      const isActive = location.pathname === item.path;
                      return (
                        <SidebarMenuItem key={item.path}>
                          <SidebarMenuButton
                            onClick={() => navigate(item.path)}
                            isActive={isActive}
                            className="transition-colors text-[15px] leading-[1.5]"
                          >
                            <item.icon className="h-4 w-4" />
                            <span>{item.title}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-border/40 p-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 px-2">
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
              <span className="text-[13px] font-medium text-muted-foreground leading-[1.4]">
                {profile?.full_name?.charAt(0)?.toUpperCase() || "S"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[15px] font-medium text-foreground leading-[1.35]">
                {profile?.full_name || "SuperAdmin"}
              </span>
              <span className="text-[13px] text-muted-foreground leading-[1.4]">Administrator</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            className="w-full justify-start text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign out
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
