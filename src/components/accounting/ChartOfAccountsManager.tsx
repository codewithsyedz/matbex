import { toast } from "sonner";
import {
  checkPartnerFundingNotRevenue,
  explainPostingError,
  type RuleViolation,
} from "@/lib/accountPostingRules";
import { PostingRuleAlert } from "@/components/accounting/PostingRuleAlert";
import { useRecordPostingRejection } from "@/hooks/usePostingRejections";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Search, Lock, CircleDollarSign, Building2, Landmark, TrendingUp, ShoppingCart, Receipt, GitBranch, Eye, EyeOff } from "lucide-react";
import { useChartOfAccounts, AccountType, ChartOfAccount, ACCOUNT_CODE_RANGES, ACCOUNT_TYPE_LABELS } from "@/hooks/useChartOfAccounts";
import { useCurrency } from "@/hooks/useCurrency";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportCoATemplateButton } from "./ExportCoATemplateButton";
import { CreateBranchSubAccountsDialog } from "./CreateBranchSubAccountsDialog";
import { AccountBranchVisibilityDialog } from "./AccountBranchVisibilityDialog";
import { useBranch } from "@/contexts/BranchContext";

const ACCOUNT_TYPE_ICONS: Record<AccountType, React.ReactNode> = {
  asset: <Building2 className="h-4 w-4" />,
  liability: <Landmark className="h-4 w-4" />,
  equity: <CircleDollarSign className="h-4 w-4" />,
  revenue: <TrendingUp className="h-4 w-4" />,
  cogs: <ShoppingCart className="h-4 w-4" />,
  expense: <Receipt className="h-4 w-4" />,
};

const ACCOUNT_TYPE_COLORS: Record<AccountType, string> = {
  asset: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  liability: 'bg-red-500/10 text-red-700 dark:text-red-400',
  equity: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  revenue: 'bg-green-500/10 text-green-700 dark:text-green-400',
  cogs: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
  expense: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
};

export function ChartOfAccountsManager() {
  const { accounts, accountsByType, isLoading, createAccount, updateAccount, deleteAccount, visibleBranchIdsFor } = useChartOfAccounts();
  const { format: formatCurrency } = useCurrency();
  const { branches } = useBranch();
  
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<ChartOfAccount | null>(null);
  const [branchSubAccountParent, setBranchSubAccountParent] = useState<ChartOfAccount | null>(null);
  const [visibilityAccount, setVisibilityAccount] = useState<ChartOfAccount | null>(null);
  const [ruleViolation, setRuleViolation] = useState<RuleViolation | null>(null);
  const recordRejection = useRecordPostingRejection();
  
  // Form state
  const [formData, setFormData] = useState({
    account_code: "",
    account_name: "",
    account_type: "asset" as AccountType,
    description: "",
    is_system_account: false,
  });

  const filteredAccounts = accounts.filter(account =>
    account.account_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    account.account_code.includes(searchTerm)
  );

  const filteredByType = filteredAccounts.reduce((acc, account) => {
    if (!acc[account.account_type]) {
      acc[account.account_type] = [];
    }
    acc[account.account_type].push(account);
    return acc;
  }, {} as Record<AccountType, ChartOfAccount[]>);

  const resetForm = () => {
    setFormData({
      account_code: "",
      account_name: "",
      account_type: "asset",
      description: "",
      is_system_account: false,
    });
  };

  const handleCreate = async () => {
    setRuleViolation(null);
    const partnerViolation = checkPartnerFundingNotRevenue([
      {
        account_code: formData.account_code,
        account_name: formData.account_name,
        account_type: formData.account_type,
      },
    ]);
    if (partnerViolation) {
      setRuleViolation(partnerViolation);
      recordRejection(partnerViolation, {
        source: "chart_of_accounts",
        origin: "client",
        entityType: "chart_of_accounts",
        fields: [
          { field: "account_code", label: "Account code", value: formData.account_code },
          { field: "account_name", label: "Account name", value: formData.account_name },
          { field: "account_type", label: "Account type", value: formData.account_type },
        ],
        values: { action: "create" },
      });
      return;
    }
    try {
      await createAccount.mutateAsync(formData);
      setIsCreateDialogOpen(false);
      resetForm();
    } catch (err) {
      const explained = explainPostingError(err);
      if (explained) {
        setRuleViolation(explained);
        recordRejection(explained, {
          source: "chart_of_accounts",
          origin: "database",
          entityType: "chart_of_accounts",
          fields: [
            { field: "account_code", label: "Account code", value: formData.account_code },
            { field: "account_name", label: "Account name", value: formData.account_name },
            { field: "account_type", label: "Account type", value: formData.account_type },
          ],
          values: { action: "create" },
        });
      }
      else toast.error((err as Error)?.message ?? "Could not create the account");
    }
  };

  const handleUpdate = async () => {
    if (!editingAccount) return;
    setRuleViolation(null);

    const partnerViolation = checkPartnerFundingNotRevenue([
      {
        account_code: editingAccount.account_code,
        account_name: formData.account_name,
        account_type: editingAccount.account_type,
      },
    ]);
    if (partnerViolation) {
      setRuleViolation(partnerViolation);
      recordRejection(partnerViolation, {
        source: "chart_of_accounts",
        origin: "client",
        entityType: "chart_of_accounts",
        entityId: editingAccount.id,
        fields: [
          { field: "account_code", label: "Account code", value: editingAccount.account_code },
          { field: "account_name", label: "Account name", value: formData.account_name },
          { field: "account_type", label: "Account type", value: editingAccount.account_type },
        ],
        values: { action: "update" },
      });
      return;
    }

    try {
      await updateAccount.mutateAsync({
        id: editingAccount.id,
        account_name: formData.account_name,
        description: formData.description,
        is_active: editingAccount.is_active,
      });
      setEditingAccount(null);
      resetForm();
    } catch (err) {
      const explained = explainPostingError(err);
      if (explained) {
        setRuleViolation(explained);
        recordRejection(explained, {
          source: "chart_of_accounts",
          origin: "database",
          entityType: "chart_of_accounts",
          entityId: editingAccount.id,
          fields: [
            { field: "account_code", label: "Account code", value: editingAccount.account_code },
            { field: "account_name", label: "Account name", value: formData.account_name },
            { field: "account_type", label: "Account type", value: editingAccount.account_type },
          ],
          values: { action: "update" },
        });
      }
      else toast.error((err as Error)?.message ?? "Could not update the account");
    }
  };

  const handleEdit = (account: ChartOfAccount) => {
    setEditingAccount(account);
    setFormData({
      account_code: account.account_code,
      account_name: account.account_name,
      account_type: account.account_type,
      description: account.description || "",
      is_system_account: account.is_system_account,
    });
  };

  const handleDelete = async (accountId: string) => {
    await deleteAccount.mutateAsync(accountId);
  };

  const handleToggleActive = async (account: ChartOfAccount) => {
    await updateAccount.mutateAsync({
      id: account.id,
      is_active: !account.is_active,
    });
  };

  const getNextAccountCode = (type: AccountType): string => {
    const range = ACCOUNT_CODE_RANGES[type];
    const typeAccounts = accountsByType[type] || [];
    
    if (typeAccounts.length === 0) {
      return range.min;
    }
    
    const maxCode = Math.max(...typeAccounts.map(a => parseInt(a.account_code)));
    const nextCode = maxCode + 1;
    
    if (nextCode > parseInt(range.max)) {
      return ""; // Range exhausted
    }
    
    return nextCode.toString();
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  const accountTypes: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'];

  return (
    <>
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <CircleDollarSign className="h-5 w-5" />
              Chart of Accounts
            </CardTitle>
            <CardDescription>
              Manage your financial account structure with enforced classification rules
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <ExportCoATemplateButton />
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => resetForm()}>
                <Plus className="h-4 w-4 mr-2" />
                Add Account
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Account</DialogTitle>
                <DialogDescription>
                  Add a new account to your Chart of Accounts
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {ruleViolation && <PostingRuleAlert violation={ruleViolation} onNavigate={() => setIsCreateDialogOpen(false)} />}
                <div className="space-y-2">
                  <Label>Account Type</Label>
                  <Select
                    value={formData.account_type}
                    onValueChange={(value: AccountType) => {
                      setFormData(prev => ({
                        ...prev,
                        account_type: value,
                        account_code: getNextAccountCode(value),
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {accountTypes.map(type => (
                        <SelectItem key={type} value={type}>
                          <div className="flex items-center gap-2">
                            {ACCOUNT_TYPE_ICONS[type]}
                            <span>{ACCOUNT_TYPE_LABELS[type]}</span>
                            <span className="text-muted-foreground text-xs">
                              ({ACCOUNT_CODE_RANGES[type].min}-{ACCOUNT_CODE_RANGES[type].max})
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {ACCOUNT_CODE_RANGES[formData.account_type].label}
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label>Account Code</Label>
                  <Input
                    value={formData.account_code}
                    onChange={e => setFormData(prev => ({ ...prev, account_code: e.target.value }))}
                    placeholder={`e.g., ${ACCOUNT_CODE_RANGES[formData.account_type].min}`}
                    maxLength={4}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Account Name</Label>
                  <Input
                    value={formData.account_name}
                    onChange={e => setFormData(prev => ({ ...prev, account_name: e.target.value }))}
                    placeholder="e.g., Cash in Bank"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Description (Optional)</Label>
                  <Textarea
                    value={formData.description}
                    onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Brief description of this account..."
                    rows={2}
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>System Account</Label>
                    <p className="text-xs text-muted-foreground">Protected from modifications</p>
                  </div>
                  <Switch
                    checked={formData.is_system_account}
                    onCheckedChange={checked => setFormData(prev => ({ ...prev, is_system_account: checked }))}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleCreate}
                  disabled={!formData.account_code || !formData.account_name || createAccount.isPending}
                >
                  {createAccount.isPending ? "Creating..." : "Create Account"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by account name or code..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Accounts by Type */}
        <Accordion type="multiple" defaultValue={accountTypes} className="w-full">
          {accountTypes.map(type => {
            const typeAccounts = filteredByType[type] || [];
            const totalBalance = typeAccounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);
            
            return (
              <AccordionItem key={type} value={type}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center justify-between w-full pr-4">
                    <div className="flex items-center gap-3">
                      <Badge className={ACCOUNT_TYPE_COLORS[type]}>
                        {ACCOUNT_TYPE_ICONS[type]}
                        <span className="ml-1">{ACCOUNT_TYPE_LABELS[type]}</span>
                      </Badge>
                      <span className="text-muted-foreground text-sm">
                        {typeAccounts.length} account{typeAccounts.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <span className="font-medium text-sm">
                      {formatCurrency(totalBalance)}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  {typeAccounts.length === 0 ? (
                    <p className="text-muted-foreground text-sm py-4 text-center">
                      No accounts in this category
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-24">Code</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {typeAccounts.map(account => (
                          <TableRow key={account.id} className={!account.is_active ? 'opacity-50' : ''}>
                            <TableCell className="font-mono font-medium">
                              {account.account_code}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {account.account_name}
                                {account.is_system_account && (
                                  <Lock className="h-3 w-3 text-muted-foreground" />
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                              {account.description || '-'}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatCurrency(account.balance)}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant={account.is_active ? "default" : "secondary"}>
                                {account.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setVisibilityAccount(account)}
                                  title="Manage branch visibility"
                                >
                                  {(() => {
                                    const v = visibleBranchIdsFor(account.id);
                                    return v ? <EyeOff className="h-4 w-4 text-amber-600" /> : <Eye className="h-4 w-4" />;
                                  })()}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setBranchSubAccountParent(account)}
                                  disabled={account.is_system_account}
                                  title="Create branch sub-accounts"
                                >
                                  <GitBranch className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleEdit(account)}
                                  disabled={account.is_system_account}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      disabled={account.has_transactions || account.is_system_account}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete Account</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Are you sure you want to delete "{account.account_name}"? 
                                        This action cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction 
                                        onClick={() => handleDelete(account.id)}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      >
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        {/* Edit Dialog */}
        <Dialog open={!!editingAccount} onOpenChange={(open) => !open && setEditingAccount(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Account</DialogTitle>
              <DialogDescription>
                Update account details. Account code and type cannot be changed.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {ruleViolation && <PostingRuleAlert violation={ruleViolation} onNavigate={() => setEditingAccount(null)} />}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Account Code</Label>
                  <Input value={formData.account_code} disabled className="bg-muted" />
                </div>
                <div className="space-y-2">
                  <Label>Account Type</Label>
                  <Input value={ACCOUNT_TYPE_LABELS[formData.account_type]} disabled className="bg-muted" />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Account Name</Label>
                <Input
                  value={formData.account_name}
                  onChange={e => setFormData(prev => ({ ...prev, account_name: e.target.value }))}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  rows={2}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Active</Label>
                  <p className="text-xs text-muted-foreground">Deactivated accounts won't appear in selections</p>
                </div>
                <Switch
                  checked={editingAccount?.is_active ?? true}
                  onCheckedChange={checked => setEditingAccount(prev => prev ? { ...prev, is_active: checked } : null)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingAccount(null)}>
                Cancel
              </Button>
              <Button 
                onClick={handleUpdate}
                disabled={!formData.account_name || updateAccount.isPending}
              >
                {updateAccount.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
    <CreateBranchSubAccountsDialog
      open={!!branchSubAccountParent}
      onOpenChange={(o) => { if (!o) setBranchSubAccountParent(null); }}
      parentAccount={branchSubAccountParent}
    />
    <AccountBranchVisibilityDialog
      open={!!visibilityAccount}
      onOpenChange={(o) => { if (!o) setVisibilityAccount(null); }}
      account={visibilityAccount}
    />
    </>
  );
}
