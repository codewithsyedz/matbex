import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  CheckCircle,
  DollarSign,
  Package,
  ShoppingCart,
  Upload,
} from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { useCOGSPosting, PendingCOGSEntry } from "@/hooks/useCOGSPosting";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export function COGSLedgerPosting() {
  const { format: formatCurrency } = useCurrency();
  const {
    cogsAccounts,
    allUnpostedEntries,
    totalUnpostedAmount,
    isLoading,
    postUsageToCOGS,
    postPurchaseToCOGS,
    bulkPostToCOGS,
  } = useCOGSPosting();

  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [selectedAccount, setSelectedAccount] = useState<string>("");

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedEntries(new Set(allUnpostedEntries.map(e => e.id)));
    } else {
      setSelectedEntries(new Set());
    }
  };

  const handleSelectEntry = (entryId: string, checked: boolean) => {
    const newSelected = new Set(selectedEntries);
    if (checked) {
      newSelected.add(entryId);
    } else {
      newSelected.delete(entryId);
    }
    setSelectedEntries(newSelected);
  };

  const handlePostSelected = () => {
    if (!selectedAccount) return;
    
    const entriesToPost = allUnpostedEntries.filter(e => selectedEntries.has(e.id));
    bulkPostToCOGS.mutate({ entries: entriesToPost, cogsAccountId: selectedAccount });
  };

  const handlePostSingle = (entry: PendingCOGSEntry) => {
    if (!selectedAccount) return;
    
    if (entry.type === 'usage') {
      postUsageToCOGS.mutate({ usageId: entry.id, cogsAccountId: selectedAccount });
    } else {
      postPurchaseToCOGS.mutate({ purchaseId: entry.id, cogsAccountId: selectedAccount });
    }
  };

  const selectedTotal = allUnpostedEntries
    .filter(e => selectedEntries.has(e.id))
    .reduce((sum, e) => sum + e.amount, 0);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-1" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              COGS Ledger Posting
            </CardTitle>
            <CardDescription>
              Post inventory consumption and purchases to COGS accounts
            </CardDescription>
          </div>
          {allUnpostedEntries.length > 0 && (
            <Badge variant="secondary" className="text-base px-3 py-1">
              {allUnpostedEntries.length} Pending • {formatCurrency(totalUnpostedAmount)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* COGS Account Warning */}
        {cogsAccounts.length === 0 && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-warning/10 border border-warning/30">
            <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
            <div>
              <p className="font-medium text-warning">No COGS Accounts Found</p>
              <p className="text-sm text-muted-foreground">
                Create a COGS account (code 5000-5999) in the Chart of Accounts before posting.
                COGS entries cannot be posted to Expense accounts.
              </p>
            </div>
          </div>
        )}

        {/* Account Selector */}
        {cogsAccounts.length > 0 && (
          <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block">
                Target COGS Account <span className="text-destructive">*</span>
              </label>
              <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                <SelectTrigger>
                  <SelectValue placeholder="Select COGS account (5000-5999)" />
                </SelectTrigger>
                <SelectContent>
                  {cogsAccounts.map(account => (
                    <SelectItem key={account.id} value={account.id}>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {account.account_code}
                        </span>
                        {account.account_name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedEntries.size > 0 && selectedAccount && (
              <Button
                onClick={handlePostSelected}
                disabled={bulkPostToCOGS.isPending}
                className="whitespace-nowrap"
              >
                <Upload className="h-4 w-4 mr-2" />
                Post {selectedEntries.size} Selected ({formatCurrency(selectedTotal)})
              </Button>
            )}
          </div>
        )}

        {/* Entries Table */}
        {allUnpostedEntries.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={selectedEntries.size === allUnpostedEntries.length}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allUnpostedEntries.map(entry => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedEntries.has(entry.id)}
                      onCheckedChange={(checked) => handleSelectEntry(entry.id, !!checked)}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant="outline" 
                      className={cn(
                        "text-xs",
                        entry.type === 'usage' 
                          ? "border-blue-500/30 text-blue-600 bg-blue-50 dark:bg-blue-950/30" 
                          : "border-emerald-500/30 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
                      )}
                    >
                      {entry.type === 'usage' ? (
                        <Package className="h-3 w-3 mr-1" />
                      ) : (
                        <ShoppingCart className="h-3 w-3 mr-1" />
                      )}
                      {entry.type === 'usage' ? 'Consumption' : 'Purchase'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{entry.item_name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(entry.date), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(entry.amount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!selectedAccount || postUsageToCOGS.isPending || postPurchaseToCOGS.isPending}
                      onClick={() => handlePostSingle(entry)}
                    >
                      <Upload className="h-3 w-3 mr-1" />
                      Post
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <CheckCircle className="h-12 w-12 mx-auto mb-3 opacity-50 text-success" />
            <p className="font-medium">All COGS entries posted</p>
            <p className="text-sm">No pending inventory consumption or purchases to post</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
