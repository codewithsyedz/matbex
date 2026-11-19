import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Users,
  TrendingUp,
  AlertTriangle,
  Clock,
  Inbox,
  CalendarCheck,
  CreditCard,
  Store,
  ArrowRight,
} from "lucide-react";
import { db } from "@/integrations/db/client";
import { ReleaseNotesPanel } from "@/components/admin/ReleaseNotesPanel";

interface Stats {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  trialTenants: number;
  totalUsers: number;
}

interface ContactRow {
  id: string;
  name: string;
  email: string;
  kind: string | null;
  message: string;
  company: string | null;
  source_path: string | null;
  preferred_date: string | null;
  preferred_slot: string | null;
  handled_at: string | null;
  created_at: string;
}

interface RestaurantRow {
  id: string;
  name: string;
  status: string | null;
  created_at: string;
  tenant_id: string | null;
}

type Bucket = "enquiry" | "demo" | "plan";

const bucketOf = (m: ContactRow): Bucket => {
  if (m.kind === "demo") return "demo";
  if (m.message.startsWith("Plan signup request") || (m.source_path ?? "").startsWith("/pricing")) return "plan";
  return "enquiry";
};

const planOf = (m: ContactRow) => {
  const match = m.message.match(/^Plan signup request:\s*([^(]+)\s*\(([^)]+)\)/);
  return match ? `${match[1].trim()} · ${match[2].trim()}` : null;
};

const timeAgo = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export default function AdminOverview() {
  const [stats, setStats] = useState<Stats>({
    totalTenants: 0,
    activeTenants: 0,
    suspendedTenants: 0,
    trialTenants: 0,
    totalUsers: 0,
  });
  const [messages, setMessages] = useState<ContactRow[]>([]);
  const [restaurants, setRestaurants] = useState<RestaurantRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [tenantsRes, usersRes, messagesRes, restaurantsRes] = await Promise.all([
          db.from("tenants").select("id, status"),
          db.from("profiles").select("id"),
          db
            .from("contact_messages")
            .select(
              "id, name, email, kind, message, company, source_path, preferred_date, preferred_slot, handled_at, created_at",
            )
            .order("created_at", { ascending: false })
            .limit(500),
          db
            .from("restaurants")
            .select("id, name, status, created_at, tenant_id")
            .order("created_at", { ascending: false })
            .limit(500),
        ]);

        const tenants = tenantsRes.data || [];
        const users = usersRes.data || [];
        setStats({
          totalTenants: tenants.length,
          activeTenants: tenants.filter((t) => t.status === "active").length,
          suspendedTenants: tenants.filter((t) => t.status === "suspended").length,
          trialTenants: tenants.filter((t) => t.status === "trial").length,
          totalUsers: users.length,
        });
        setMessages((messagesRes.data as ContactRow[]) || []);
        setRestaurants((restaurantsRes.data as RestaurantRow[]) || []);
      } catch (error) {
        console.error("Error fetching overview:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, []);

  const buckets = useMemo(() => {
    const since = Date.now() - SEVEN_DAYS_MS;
    const group = (b: Bucket) => messages.filter((m) => bucketOf(m) === b);
    const summarize = (rows: ContactRow[]) => ({
      rows,
      total: rows.length,
      week: rows.filter((r) => new Date(r.created_at).getTime() >= since).length,
      waiting: rows.filter((r) => !r.handled_at).length,
    });
    return {
      enquiry: summarize(group("enquiry")),
      demo: summarize(group("demo")),
      plan: summarize(group("plan")),
      restaurants: {
        total: restaurants.length,
        week: restaurants.filter((r) => new Date(r.created_at).getTime() >= since).length,
        active: restaurants.filter((r) => (r.status ?? "active") === "active").length,
      },
    };
  }, [messages, restaurants]);

  const pipelineCards = [
    {
      title: "Enquiries",
      icon: Inbox,
      value: buckets.enquiry.total,
      sub: `${buckets.enquiry.week} this week · ${buckets.enquiry.waiting} waiting`,
      to: "/admin/contact-messages",
    },
    {
      title: "Demo bookings",
      icon: CalendarCheck,
      value: buckets.demo.total,
      sub: `${buckets.demo.week} this week · ${buckets.demo.waiting} unconfirmed`,
      to: "/admin/contact-messages",
    },
    {
      title: "Plan signups",
      icon: CreditCard,
      value: buckets.plan.total,
      sub: `${buckets.plan.week} this week · ${buckets.plan.waiting} not yet set up`,
      to: "/admin/enquiries",
    },
    {
      title: "Restaurant accounts",
      icon: Store,
      value: buckets.restaurants.total,
      sub: `${buckets.restaurants.week} new this week · ${buckets.restaurants.active} active`,
      to: "/admin/tenants",
    },
  ];

  const statCards = [
    { title: "Total Tenants", value: stats.totalTenants, description: "Registered organizations", icon: Building2, color: "text-primary" },
    { title: "Active Tenants", value: stats.activeTenants, description: "Currently active", icon: TrendingUp, color: "text-green-500" },
    { title: "Trial Tenants", value: stats.trialTenants, description: "In trial period", icon: Clock, color: "text-blue-500" },
    { title: "Suspended", value: stats.suspendedTenants, description: "Temporarily disabled", icon: AlertTriangle, color: "text-amber-500" },
    { title: "Total Users", value: stats.totalUsers, description: "Across all tenants", icon: Users, color: "text-purple-500" },
  ];

  const renderRecent = (rows: ContactRow[], kind: Bucket) => {
    if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing yet.</p>;
    return (
      <ul className="divide-y divide-border/60">
        {rows.slice(0, 5).map((r) => (
          <li key={r.id} className="py-2.5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {r.name}
                {r.company ? <span className="text-muted-foreground font-normal"> · {r.company}</span> : null}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {kind === "demo" && r.preferred_date
                  ? `${r.preferred_date}${r.preferred_slot ? ` at ${r.preferred_slot}` : ""} · `
                  : null}
                {kind === "plan" && planOf(r) ? `${planOf(r)} · ` : null}
                {r.email}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span className="text-[11px] text-muted-foreground">{timeAgo(r.created_at)}</span>
              <Badge variant={r.handled_at ? "secondary" : "outline"} className="text-[10px]">
                {r.handled_at ? "Replied" : "Waiting"}
              </Badge>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Platform Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Enquiries, demo bookings, plan signups and restaurant accounts in one place.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {pipelineCards.map((card) => (
          <Card key={card.title} className="border-border/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
              <card.icon className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{loading ? "..." : card.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
              <Button asChild variant="link" size="sm" className="px-0 h-auto mt-2 text-xs">
                <Link to={card.to}>
                  Open <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Latest enquiries</CardTitle>
            <CardDescription>From the residency and contact forms</CardDescription>
          </CardHeader>
          <CardContent>{renderRecent(buckets.enquiry.rows, "enquiry")}</CardContent>
        </Card>
        <Card className="border-border/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Upcoming demos</CardTitle>
            <CardDescription>Requested slots, Riyadh time</CardDescription>
          </CardHeader>
          <CardContent>{renderRecent(buckets.demo.rows, "demo")}</CardContent>
        </Card>
        <Card className="border-border/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Plan signups</CardTitle>
            <CardDescription>Submitted from the pricing page</CardDescription>
          </CardHeader>
          <CardContent>{renderRecent(buckets.plan.rows, "plan")}</CardContent>
        </Card>
        <Card className="border-border/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Newest restaurants</CardTitle>
            <CardDescription>Accounts created on the platform</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : restaurants.length === 0 ? (
              <p className="text-sm text-muted-foreground">No restaurants yet.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {restaurants.slice(0, 5).map((r) => (
                  <li key={r.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{timeAgo(r.created_at)}</p>
                    </div>
                    <Badge variant={(r.status ?? "active") === "active" ? "secondary" : "outline"} className="text-[10px]">
                      {r.status ?? "active"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {statCards.map((card) => (
          <Card key={card.title} className="border-border/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{loading ? "..." : card.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{card.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <ReleaseNotesPanel compact />
    </div>
  );
}
