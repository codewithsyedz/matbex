import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReasonBadge } from "./ReasonBadge";

const RULES: { code: string; outcome: string }[] = [
  { code: "ready", outcome: "Posts immediately on bulk action." },
  { code: "pending_approval", outcome: "Skipped — approve the expense first." },
  { code: "period_locked", outcome: "Skipped — unlock the fiscal period." },
  { code: "missing_account", outcome: "Skipped — assign a Chart of Accounts mapping." },
  { code: "cogs_routed", outcome: "Blocked by design — record via Inventory Purchase." },
  { code: "missing_branch_visibility", outcome: "Skipped — enable account visibility for this branch." },
];

export function PostingRulesCard() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Posting rules</CardTitle>
        <p className="text-xs text-muted-foreground">
          What happens to each type of unposted entry when you bulk post.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {RULES.map((r) => (
            <li
              key={r.code}
              className="py-2 flex items-center justify-between gap-3"
            >
              <ReasonBadge code={r.code as any} />
              <span className="text-xs text-muted-foreground text-right">
                {r.outcome}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}