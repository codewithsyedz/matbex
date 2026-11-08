import { Percent } from "lucide-react";

import { PendingVatSplitPanel } from "@/components/expenses/PendingVatSplitPanel";
import { VatSplitAuditTrail } from "@/components/expenses/VatSplitAuditTrail";

export default function PendingVatSplitPage() {
  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
          <Percent className="h-7 w-7" />
          Pending VAT Split
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Expenses recorded without a net / VAT split. Apply the correct rate to move the
          recoverable tax to 1180 Input VAT, or mark the bill as no VAT applicable.
        </p>
      </header>

      <PendingVatSplitPanel collapsible={false} renderWhenEmpty />

      <VatSplitAuditTrail />
    </div>
  );
}
