import {
  Coffee,
  Truck,
  Zap,
  UtensilsCrossed,
  Cookie,
  Cloud,
  type LucideIcon,
} from "lucide-react";

export interface SolutionMechanism {
  title: string;
  body: string;
}

export interface Solution {
  slug: string;
  icon: LucideIcon;
  /** Short name used in chips, cards and breadcrumbs. */
  name: string;
  /** Page H1 — states the problem, not the product. */
  headline: string;
  summary: string;
  seoTitle: string;
  seoDescription: string;
  /** Card copy on the index page and the venue chips on the home page. */
  teaser: string;
  before: string[];
  after: string[];
  mechanisms: [SolutionMechanism, SolutionMechanism, SolutionMechanism];
  quote: { text: string; author: string; role: string };
  /** Two sibling slugs — every page links laterally. */
  related: [string, string];
}

export const SOLUTIONS: Solution[] = [
  {
    slug: "coffee-shops",
    icon: Coffee,
    name: "Coffee shops & cafés",
    headline: "You sell a thousand cups a week and still guess what a cup costs",
    summary:
      "Matbex prices every pour, pastry and syrup pump against live purchase costs, so your margin is a number on a screen rather than a feeling at the end of the month.",
    seoTitle: "POS & Cost Control for Coffee Shops in Saudi Arabia | Matbex",
    seoDescription:
      "Speed-checkout POS, live bean and milk costing, waste tracking and ZATCA e-invoicing built for Saudi cafés and espresso bars. See true margin per cup.",
    teaser: "Espresso bars and full-service cafés: fast checkout, live cost per cup.",
    before: [
      "Bean and milk invoices land in a WhatsApp group",
      "Cup price set once and never revisited",
      "Waste at close is noticed, never recorded",
      "Month-end margin is a surprise",
    ],
    after: [
      "Every invoice posts to inventory the day it arrives",
      "Recipe costing updates the moment supplier prices move",
      "Closing waste is logged in seconds from the counter",
      "Daily profit is on the owner's phone by 11 PM",
    ],
    mechanisms: [
      {
        title: "Checkout that keeps the queue moving",
        body: "A single-tap till with modifiers, saved favourites and offline mode. If the internet drops mid-rush, sales keep recording and sync the moment it returns.",
      },
      {
        title: "Recipe costing down to the gram",
        body: "Link each drink to its beans, milk, cup and lid. When a supplier raises a price, every affected menu item reprices its cost automatically.",
      },
      {
        title: "Waste and shrinkage in the open",
        body: "Spoiled milk and dropped pastries are logged as waste, not buried in cost of goods, so you can see what carelessness actually costs per week.",
      },
    ],
    quote: {
      text: "We found four riyals of unrecorded milk waste per day in the first week. That is a barista's salary over a year.",
      author: "Operations lead",
      role: "Three-branch café group, Riyadh",
    },
    related: ["bakeries", "quick-service"],
  },
  {
    slug: "quick-service",
    icon: Zap,
    name: "Quick-service restaurants",
    headline: "Rush hour hides the money leaking out of your counter",
    summary:
      "High-volume service needs high-speed accuracy. Matbex depletes inventory as each order rings, reconciles the drawer at close and shows profit for the day before the lights go off.",
    seoTitle: "QSR POS, Inventory & Profit Tracking in KSA | Matbex",
    seoDescription:
      "Built for high-volume Saudi quick-service counters: fast POS, automatic inventory depletion, drawer reconciliation and daily profit reporting with ZATCA compliance.",
    teaser: "High-volume counters: throughput, automatic depletion, live profit.",
    before: [
      "Orders rung faster than stock can be counted",
      "Drawer variance blamed on the busy hour",
      "Aggregator payouts reconciled weeks later",
      "No idea which combo actually earns",
    ],
    after: [
      "Stock depletes automatically with every ticket",
      "Shift close forces a count and explains any variance",
      "Aggregator settlements matched against recorded sales",
      "Item-level margin ranks your menu honestly",
    ],
    mechanisms: [
      {
        title: "Throughput without shortcuts",
        body: "Keyboard, touch and barcode entry on the same screen, with combos and modifiers one tap deep. Cashiers never leave the sale to look something up.",
      },
      {
        title: "Shift control that closes properly",
        body: "Opening float, cash events during the shift and a mandatory count at close. Large variances block closure until a manager signs them off.",
      },
      {
        title: "Delivery platforms reconciled",
        body: "Orders from aggregators land beside your own, commissions and settlements are tracked, and channel profit is reported separately from dine-in.",
      },
    ],
    quote: {
      text: "The drawer used to be short a hundred riyals most weeks. Now it is short nothing, because it has to be explained before anyone goes home.",
      author: "Branch manager",
      role: "Quick-service chain, Jeddah",
    },
    related: ["cloud-kitchens", "multi-branch"],
  },
  {
    slug: "full-service",
    icon: UtensilsCrossed,
    name: "Full-service restaurants",
    headline: "Table service, kitchen and accounts should not be three systems",
    summary:
      "One floor plan, one kitchen display, one ledger. Matbex carries a table from seating to settled invoice to posted journal entry without anyone re-typing a number.",
    seoTitle: "Restaurant Management System for Full-Service Dining | Matbex",
    seoDescription:
      "Floor plans, kitchen display, split bills, payroll and ZATCA-compliant invoicing in one Saudi restaurant operating system. From seating to posted accounts.",
    teaser: "Dining rooms: floor plan, kitchen coordination, full accounting.",
    before: [
      "POS, kitchen tickets and accounts kept apart",
      "Split bills argued over at the table",
      "Payroll rebuilt in a spreadsheet each month",
      "Accountant chases receipts long after service",
    ],
    after: [
      "One ticket path from table to kitchen to invoice",
      "Splits, transfers and merges handled at the table",
      "Payroll, advances and fines calculated from real shifts",
      "Journal entries posted the same day, in balance",
    ],
    mechanisms: [
      {
        title: "A floor plan that matches the room",
        body: "Drag your real tables into place, move a party between them and see which sections are turning fastest during service.",
      },
      {
        title: "Kitchen display, not paper",
        body: "Tickets route to the right station, timers show what is running late, and the pass sees the whole table rather than six unrelated dishes.",
      },
      {
        title: "Accounting that keeps itself",
        body: "Sales, purchases, payroll and overheads post to a double-entry ledger with ZATCA-compliant invoices — no monthly rebuild, no re-keying.",
      },
    ],
    quote: {
      text: "The accountant used to spend the first week of every month reconstructing the last one. Now she reviews instead of rebuilds.",
      author: "Owner",
      role: "Fine-casual restaurant, Riyadh",
    },
    related: ["multi-branch", "coffee-shops"],
  },
  {
    slug: "cloud-kitchens",
    icon: Cloud,
    name: "Cloud & ghost kitchens",
    headline: "Five brands, one kitchen, and no clear idea which one earns",
    summary:
      "Matbex separates brands and channels while sharing one inventory, so you can see commission, packaging and food cost per brand instead of one blended blur.",
    seoTitle: "Cloud Kitchen Software: Multi-Brand Costing & Aggregators | Matbex",
    seoDescription:
      "Run multiple delivery brands from one kitchen with shared inventory, per-brand profit, aggregator settlement matching and ZATCA e-invoicing in Saudi Arabia.",
    teaser: "Delivery-only: multi-brand inventory, aggregator sync, channel profit.",
    before: [
      "Brand performance blended into one total",
      "Commission treated as a cost of doing business",
      "Packaging cost never entered anywhere",
      "Aggregator payouts trusted without checking",
    ],
    after: [
      "Profit reported per brand and per channel",
      "Commission and fees modelled into item margin",
      "Packaging costed alongside ingredients",
      "Every settlement matched to the orders behind it",
    ],
    mechanisms: [
      {
        title: "Shared stock, separate books",
        body: "One store of ingredients feeds every brand, while sales, costs and margin stay reported brand by brand.",
      },
      {
        title: "Aggregators reconciled to the riyal",
        body: "Orders, commissions and deposits from each platform are matched against what actually landed in the bank, and gaps are flagged.",
      },
      {
        title: "Channel P&L, not guesswork",
        body: "See what delivery earns after commission next to what pickup earns, and decide which brand deserves the next menu slot.",
      },
    ],
    quote: {
      text: "Two of our five brands were losing money after commission. We only knew because the report finally split them.",
      author: "Founder",
      role: "Multi-brand cloud kitchen, Dammam",
    },
    related: ["quick-service", "food-trucks"],
  },
  {
    slug: "bakeries",
    icon: Cookie,
    name: "Bakeries & pastry shops",
    headline: "Production runs turn flour into product — and into unanswered questions",
    summary:
      "Batch production, yield loss and per-item cost are tracked properly, so you know what a croissant costs before you decide what to charge for it.",
    seoTitle: "Bakery Costing, Production & POS Software in KSA | Matbex",
    seoDescription:
      "Track ingredient batches, production runs, yields and per-item margin for Saudi bakeries and pastry shops, with retail POS and ZATCA-compliant invoicing.",
    teaser: "Batch production, yields and per-item margin on every bake.",
    before: [
      "Recipes scaled by memory each morning",
      "Yield loss absorbed silently",
      "Day-old stock written off without a record",
      "Prices set against the shop next door",
    ],
    after: [
      "Production runs consume stock at real quantities",
      "Yield and trim loss recorded per batch",
      "Write-offs logged as waste with a reason",
      "Prices set from cost plus a margin you chose",
    ],
    mechanisms: [
      {
        title: "Batch-level production",
        body: "Record a bake once and Matbex consumes the flour, butter and filling behind it, then adds finished units to the counter.",
      },
      {
        title: "Honest yields",
        body: "Planned versus actual output per batch shows which recipes lose more than they should, and which oven or shift is behind it.",
      },
      {
        title: "Cost-led pricing",
        body: "Every item carries a live cost, a target margin and the price that satisfies it, so a supplier increase becomes a decision instead of a slow leak.",
      },
    ],
    quote: {
      text: "Our best-selling cake had the worst margin in the shop. Six months of volume, almost no profit.",
      author: "Head baker",
      role: "Pastry house, Khobar",
    },
    related: ["coffee-shops", "full-service"],
  },
  {
    slug: "food-trucks",
    icon: Truck,
    name: "Food trucks & mobile kitchens",
    headline: "Service does not stop because the signal does",
    summary:
      "An offline-first till that keeps taking orders in a car park with no bars, then syncs everything the moment it reconnects — with the books still balanced.",
    seoTitle: "Offline-First POS for Food Trucks & Mobile Kitchens | Matbex",
    seoDescription:
      "Take orders without a connection, sync automatically when signal returns, and keep inventory, cash control and ZATCA invoicing intact across every event.",
    teaser: "On the move: offline-first POS, simple stock, shift control anywhere.",
    before: [
      "Sales written on paper when signal drops",
      "Stock loaded by eye each morning",
      "Cash counted at home, hours later",
      "Event profitability judged on gut feel",
    ],
    after: [
      "Every sale recorded on the device, online or not",
      "A short prep list covers a truck's real inventory",
      "Drawer counted and closed on site",
      "Profit per event, per location, per day",
    ],
    mechanisms: [
      {
        title: "Offline-first by design",
        body: "The till stores sales locally and reconciles them with the server automatically. Nothing is lost, nothing is entered twice.",
      },
      {
        title: "Inventory sized for a truck",
        body: "A short list of what you actually carry, with low-stock warnings before you drive out rather than after you sell out.",
      },
      {
        title: "Close out where you park",
        body: "Count the drawer, log expenses like fuel and permits, and see the event's profit before you drive home.",
      },
    ],
    quote: {
      text: "We used to lose an hour a night typing paper receipts back in. Now closing takes four minutes on the truck.",
      author: "Owner-operator",
      role: "Mobile kitchen, Riyadh",
    },
    related: ["quick-service", "cloud-kitchens"],
  },
  {
    slug: "multi-branch",
    icon: UtensilsCrossed,
    name: "Multi-branch groups",
    headline: "Four branches, four versions of the truth",
    summary:
      "Branch-scoped operations under one set of books: compare branches on the same measures, keep prices and menus branch-aware, and consolidate without a spreadsheet.",
    seoTitle: "Multi-Branch Restaurant Management & Consolidated P&L | Matbex",
    seoDescription:
      "Compare branches on identical measures, run branch-specific menus and prices, and consolidate profit and loss across a Saudi restaurant group in one system.",
    teaser: "Groups: branch-scoped books, comparable measures, one consolidation.",
    before: [
      "Each branch reports in its own format",
      "Menu prices drift between locations",
      "Group P&L assembled by hand each month",
      "Weak branches spotted a quarter too late",
    ],
    after: [
      "One chart of accounts, scoped per branch",
      "Branch-aware menus, prices and availability",
      "Consolidated and per-branch P&L on demand",
      "Branch league tables on food cost and labour",
    ],
    mechanisms: [
      {
        title: "Branch-scoped everything",
        body: "Sales, expenses, payroll, stock and journals all carry a branch, so any report can be read for one location or the whole group.",
      },
      {
        title: "Menus that differ where they should",
        body: "Set a group menu, then override prices, categories and availability per branch without maintaining separate menus.",
      },
      {
        title: "Comparison as a habit",
        body: "Food cost, labour cost and prime cost side by side across branches, so a drifting location is obvious in days rather than quarters.",
      },
    ],
    quote: {
      text: "One branch was running eight points higher on food cost. Nobody could see it before because nobody measured the same way.",
      author: "Group operations director",
      role: "Seven-branch restaurant group, KSA",
    },
    related: ["full-service", "quick-service"],
  },
];

export function getSolution(slug: string | undefined): Solution | undefined {
  return SOLUTIONS.find((s) => s.slug === slug);
}
