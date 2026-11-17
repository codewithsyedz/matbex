import { useEffect, useState, useMemo } from "react";
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

export const adminNavGroups = [
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
  const { isMobile, setOpenMobile } = useSidebar();

  const activeGroupLabel = useMemo(() => {
    const path = location.pathname.startsWith("/admin/tenants/") ? "/admin/tenants" : location.pathname;
    return adminNavGroups.find((g) => g.items.some((i) => i.path === path))?.label ?? null;
  }, [location.pathname]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(adminNavGroups.map((g) => [g.label, g.label === activeGroupLabel || g.label === "Overview"])),
  );
  // Opening a page from elsewhere (a link, the back button) opens its group too.
  useEffect(() => {
    if (activeGroupLabel) setOpenGroups((prev) => (prev[activeGroupLabel] ? prev : { ...prev, [activeGroupLabel]: true }));
  }, [activeGroupLabel]);

  const setAll = (open: boolean) => setOpenGroups(Object.fromEntries(adminNavGroups.map((g) => [g.label, open])));
  const allExpanded = adminNavGroups.every((g) => openGroups[g.label]);
  const allCollapsed = adminNavGroups.every((g) => !openGroups[g.label]);

  const go = (path: string) => {
    navigate(path);
    if (isMobile) setOpenMobile(false);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const name = profile?.full_name || "SuperAdmin";

  return (
    <Sidebar className="border-e border-border/60">
      <SidebarHeader className="gap-3 border-b border-border/60 px-4 py-4">
        <div className="flex items-center gap-3">
          <MatbexLogo size="sm" showWordmark={false} animate={false} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold leading-tight text-foreground">SuperAdmin</span>
            <span className="truncate text-xs leading-tight text-muted-foreground">Platform management</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setAll(true)} disabled={allExpanded}
            className="h-7 flex-1 justify-center gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground">
            <Maximize2 className="h-3.5 w-3.5" />Expand all
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAll(false)} disabled={allCollapsed}
            className="h-7 flex-1 justify-center gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground">
            <Minimize2 className="h-3.5 w-3.5" />Collapse all
          </Button>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 px-2 py-2">
        {adminNavGroups.map((group) => {
          const open = openGroups[group.label] ?? false;
          const hasActive = group.label === activeGroupLabel;
          return (
            <Collapsible key={group.label} open={open} onOpenChange={() => setOpenGroups((p) => ({ ...p, [group.label]: !p[group.label] }))}>
              <SidebarGroup className="p-0 py-0.5">
                <CollapsibleTrigger asChild>
                  <SidebarGroupLabel asChild>
                    <button type="button" aria-expanded={open}
                      className={`flex h-8 w-full items-center justify-between rounded-md px-2 text-[11px] font-semibold uppercase tracking-wider transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${hasActive ? "text-foreground" : "text-muted-foreground"}`}>
                      <span>{group.label}</span>
                      <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
                    </button>
                  </SidebarGroupLabel>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarGroupContent className="pb-1.5 pt-0.5">
                    <SidebarMenu className="gap-0.5">
                      {group.items.map((item) => {
                        const isActive = location.pathname === item.path
                          || (item.path === "/admin/tenants" && location.pathname.startsWith("/admin/tenants/"));
                        return (
                          <SidebarMenuItem key={item.path}>
                            <SidebarMenuButton onClick={() => go(item.path)} isActive={isActive} tooltip={item.title}
                              className="h-9 gap-2.5 px-2.5 text-sm font-normal data-[active=true]:font-medium">
                              <item.icon className="h-4 w-4 shrink-0" />
                              <span className="truncate">{item.title}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="gap-1 border-t border-border/60 p-3">
        <div className="flex items-center gap-2.5 px-1.5 py-1">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium leading-tight text-foreground">{name}</span>
            <span className="truncate text-xs leading-tight text-muted-foreground">Administrator</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={handleSignOut}
          className="h-9 w-full justify-start gap-2.5 px-2.5 text-sm font-normal text-muted-foreground hover:text-foreground">
          <LogOut className="h-4 w-4" />Sign out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
