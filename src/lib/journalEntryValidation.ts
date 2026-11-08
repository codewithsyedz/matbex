/**
 * Journal Entry Validation Engine
 * 
 * Enforces strict double-entry rules by entry type to prevent
 * incorrect COGS-to-Inventory postings.
 */

import { AccountType } from '@/hooks/useChartOfAccounts';

// Journal entry types with strict account rules
export type JournalEntryType = 
  | 'purchase'        // Inventory purchases: DR Inventory, CR Cash/Bank/AP
  | 'consumption'     // COGS recognition: DR COGS, CR Inventory
  | 'sale'            // Sales: DR Cash/Bank/AR, CR Revenue
  | 'expense'         // Operating expenses: DR Expense, CR Cash/Bank/AP
  | 'adjustment'      // Generic adjustments
  | 'correction'      // Corrections
  | 'reversal'        // Reversals
  | 'opening_balance'; // Opening balances

export interface JournalEntryTypeConfig {
  value: JournalEntryType;
  label: string;
  description: string;
  icon: string;
  debitAccountRules: AccountCodeRule;
  creditAccountRules: AccountCodeRule;
  helpText: string;
}

export interface AccountCodeRule {
  allowedRanges: { min: string; max: string; label: string }[];
  allowedTypes: AccountType[];
  blockedRanges?: { min: string; max: string; label: string }[];
  required?: boolean;
}

// Account code ranges for filtering
export const ACCOUNT_RANGES = {
  cash_bank: { min: '1000', max: '1200', label: 'Cash & Bank (1000-1199)' },
  inventory: { min: '1200', max: '1300', label: 'Inventory (1200-1299)' },
  receivables: { min: '1100', max: '1200', label: 'Receivables (1100-1199)' },
  liabilities: { min: '2000', max: '3000', label: 'Liabilities (2000-2999)' },
  ap: { min: '2000', max: '2100', label: 'Accounts Payable (2000-2099)' },
  revenue: { min: '4000', max: '5000', label: 'Revenue (4000-4999)' },
  cogs: { min: '5000', max: '6000', label: 'COGS (5000-5999)' },
  expenses: { min: '6000', max: '7000', label: 'Expenses (6000-6999)' },
} as const;

// Entry type configurations with strict rules
export const JOURNAL_ENTRY_TYPES: Record<JournalEntryType, JournalEntryTypeConfig> = {
  purchase: {
    value: 'purchase',
    label: 'Inventory Purchase',
    description: 'Buying stock (food, beverages, supplies)',
    icon: 'ShoppingCart',
    debitAccountRules: {
      allowedRanges: [ACCOUNT_RANGES.inventory],
      allowedTypes: ['asset'],
      required: true,
    },
    creditAccountRules: {
      allowedRanges: [ACCOUNT_RANGES.cash_bank, ACCOUNT_RANGES.liabilities],
      allowedTypes: ['asset', 'liability'],
      blockedRanges: [ACCOUNT_RANGES.cogs, ACCOUNT_RANGES.inventory],
      required: true,
    },
    helpText: 'Purchases increase inventory (DR 1200) and reduce cash or increase payables (CR 1000/2000).',
  },
  
  consumption: {
    value: 'consumption',
    label: 'COGS Recognition',
    description: 'Moving cost from inventory to COGS (consumption)',
    icon: 'TrendingDown',
    debitAccountRules: {
      allowedRanges: [ACCOUNT_RANGES.cogs],
      allowedTypes: ['cogs'],
      required: true,
    },
    creditAccountRules: {
      allowedRanges: [ACCOUNT_RANGES.inventory],
      allowedTypes: ['asset'],
      required: true,
    },
    helpText: 'Consumption moves value from Inventory (CR 1200) to COGS (DR 5000).',
  },
  
  sale: {
    value: 'sale',
    label: 'Sales Entry',
    description: 'Recording revenue from sales',
    icon: 'DollarSign',
    debitAccountRules: {
      allowedRanges: [ACCOUNT_RANGES.cash_bank],
      allowedTypes: ['asset'],
      required: true,
    },
    creditAccountRules: {
      allowedRanges: [ACCOUNT_RANGES.revenue, ACCOUNT_RANGES.liabilities],
      allowedTypes: ['revenue', 'liability'],
      blockedRanges: [ACCOUNT_RANGES.cogs, ACCOUNT_RANGES.inventory],
      required: true,
    },
    helpText: 'Sales increase cash/receivables (DR 1000) and record revenue (CR 4000).',
  },
  
  expense: {
    value: 'expense',
    label: 'Operating Expense',
    description: 'Recording operating costs (not inventory)',
    icon: 'Receipt',
    debitAccountRules: {
      allowedRanges: [ACCOUNT_RANGES.expenses, ACCOUNT_RANGES.cogs],
      allowedTypes: ['expense', 'cogs'],
      blockedRanges: [ACCOUNT_RANGES.inventory],
      required: true,
    },
    creditAccountRules: {
      allowedRanges: [ACCOUNT_RANGES.cash_bank, ACCOUNT_RANGES.liabilities],
      allowedTypes: ['asset', 'liability'],
      required: true,
    },
    helpText: 'Expenses increase cost (DR 6000) and reduce cash or increase payables (CR 1000/2000).',
  },
  
  adjustment: {
    value: 'adjustment',
    label: 'Adjustment',
    description: 'General adjustments and corrections',
    icon: 'Settings',
    debitAccountRules: {
      allowedRanges: [],
      allowedTypes: ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'],
    },
    creditAccountRules: {
      allowedRanges: [],
      allowedTypes: ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'],
    },
    helpText: 'Adjustments can use any valid account pair. Ensure debits equal credits.',
  },
  
  correction: {
    value: 'correction',
    label: 'Correction',
    description: 'Correcting previous entries',
    icon: 'Edit',
    debitAccountRules: {
      allowedRanges: [],
      allowedTypes: ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'],
    },
    creditAccountRules: {
      allowedRanges: [],
      allowedTypes: ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'],
    },
    helpText: 'Corrections reverse or adjust previous entries.',
  },
  
  reversal: {
    value: 'reversal',
    label: 'Reversal',
    description: 'Reversing a previous entry',
    icon: 'Undo',
    debitAccountRules: {
      allowedRanges: [],
      allowedTypes: ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'],
    },
    creditAccountRules: {
      allowedRanges: [],
      allowedTypes: ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'],
    },
    helpText: 'Reversals create opposite entries to cancel previous transactions.',
  },
  
  opening_balance: {
    value: 'opening_balance',
    label: 'Opening Balance',
    description: 'Initial account balances',
    icon: 'Play',
    debitAccountRules: {
      allowedRanges: [],
      allowedTypes: ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'],
    },
    creditAccountRules: {
      allowedRanges: [],
      allowedTypes: ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'],
    },
    helpText: 'Opening balances establish initial account values.',
  },
};

/**
 * Check if an account is allowed for a specific entry type and side (debit/credit)
 */
export function isAccountAllowedForEntry(
  accountCode: string,
  accountType: AccountType,
  entryType: JournalEntryType,
  side: 'debit' | 'credit'
): { allowed: boolean; reason?: string } {
  const config = JOURNAL_ENTRY_TYPES[entryType];
  const rules = side === 'debit' ? config.debitAccountRules : config.creditAccountRules;
  
  // Check blocked ranges first
  if (rules.blockedRanges) {
    for (const range of rules.blockedRanges) {
      if (accountCode >= range.min && accountCode < range.max) {
        return {
          allowed: false,
          reason: `${range.label} accounts are not allowed on the ${side} side for ${config.label} entries.`,
        };
      }
    }
  }
  
  // If no specific ranges are defined, check by type
  if (rules.allowedRanges.length === 0) {
    if (!rules.allowedTypes.includes(accountType)) {
      return {
        allowed: false,
        reason: `${accountType} accounts are not allowed on the ${side} side for ${config.label} entries.`,
      };
    }
    return { allowed: true };
  }
  
  // Check allowed ranges
  for (const range of rules.allowedRanges) {
    if (accountCode >= range.min && accountCode < range.max) {
      return { allowed: true };
    }
  }
  
  // Also check by type as fallback
  if (rules.allowedTypes.includes(accountType)) {
    return { allowed: true };
  }
  
  const allowedLabels = rules.allowedRanges.map(r => r.label).join(' or ');
  return {
    allowed: false,
    reason: `${config.label} ${side} entries must use ${allowedLabels} accounts.`,
  };
}

/**
 * Filter accounts based on entry type and side
 */
export function filterAccountsForEntry<T extends { account_code: string; account_type: AccountType }>(
  accounts: T[],
  entryType: JournalEntryType,
  side: 'debit' | 'credit'
): T[] {
  return accounts.filter(account => {
    const result = isAccountAllowedForEntry(
      account.account_code,
      account.account_type as AccountType,
      entryType,
      side
    );
    return result.allowed;
  });
}

/**
 * Validate a complete journal entry before submission
 */
export interface JournalLineValidation {
  account_id: string;
  account_code: string;
  account_type: AccountType;
  debit?: number;
  credit?: number;
}

export function validateJournalEntry(
  entryType: JournalEntryType,
  lines: JournalLineValidation[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const config = JOURNAL_ENTRY_TYPES[entryType];
  
  // Check balance
  const totalDebits = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredits = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
  
  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    errors.push(`Entry is unbalanced. Debits (${totalDebits.toFixed(2)}) must equal Credits (${totalCredits.toFixed(2)}).`);
  }
  
  // Check each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const side = (line.debit && line.debit > 0) ? 'debit' : 'credit';
    
    const result = isAccountAllowedForEntry(
      line.account_code,
      line.account_type,
      entryType,
      side
    );
    
    if (!result.allowed && result.reason) {
      errors.push(`Line ${i + 1}: ${result.reason}`);
    }
  }
  
  // Check required sides have entries
  const hasDebit = lines.some(l => l.debit && l.debit > 0);
  const hasCredit = lines.some(l => l.credit && l.credit > 0);
  
  if (config.debitAccountRules.required && !hasDebit) {
    errors.push(`${config.label} entries require at least one debit line.`);
  }
  
  if (config.creditAccountRules.required && !hasCredit) {
    errors.push(`${config.label} entries require at least one credit line.`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get helpful error message for common mistakes
 */
export function getEntryTypeErrorMessage(
  entryType: JournalEntryType,
  attemptedAccountCode: string,
  side: 'debit' | 'credit'
): string | null {
  // Common mistake: Trying to post COGS to Inventory
  if (entryType === 'consumption' && side === 'debit') {
    if (attemptedAccountCode >= '1200' && attemptedAccountCode < '1300') {
      return 'COGS entries must DEBIT a COGS account (5000-5999), not Inventory. Inventory is CREDITED to reduce it.';
    }
  }
  
  // Common mistake: Trying to post Purchases to COGS
  if (entryType === 'purchase') {
    if (attemptedAccountCode >= '5000' && attemptedAccountCode < '6000') {
      return 'Purchases should not hit COGS accounts. Use Inventory (1200-1299) for purchases. Use CONSUMPTION to recognize cost later.';
    }
  }
  
  // Common mistake: Including COGS or Inventory in Sales
  if (entryType === 'sale') {
    if (attemptedAccountCode >= '5000' && attemptedAccountCode < '6000') {
      return 'Sales entries should not include COGS. Record revenue only. Use CONSUMPTION entries for cost recognition.';
    }
    if (attemptedAccountCode >= '1200' && attemptedAccountCode < '1300') {
      return 'Sales entries should not include Inventory. Record revenue only. Use CONSUMPTION entries for inventory reduction.';
    }
  }
  
  return null;
}
