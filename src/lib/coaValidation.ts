/**
 * CoA Validation Engine - Frontend Utilities
 * 
 * Provides explicit error message parsing and validation helpers
 * for Chart of Accounts transaction integrity.
 */

import { AccountType, ACCOUNT_CODE_RANGES, ACCOUNT_TYPE_LABELS } from '@/hooks/useChartOfAccounts';

// Validation error codes for explicit messaging
export const COA_ERROR_CODES = {
  MISSING_ACCOUNT: 'COA_MISSING_ACCOUNT',
  INACTIVE_ACCOUNT: 'COA_INACTIVE_ACCOUNT',
  CROSS_TENANT: 'COA_CROSS_TENANT',
  INVALID_REFERENCE_TYPE: 'COA_INVALID_REF_TYPE',
  INVALID_ACCOUNT_TYPE_MAPPING: 'COA_TYPE_MISMATCH',
  MISSING_AMOUNT: 'COA_MISSING_AMOUNT',
  DOUBLE_ENTRY_VIOLATION: 'COA_DOUBLE_ENTRY',
  ACCOUNT_CODE_RANGE: 'COA_CODE_RANGE',
  DUPLICATE_ACCOUNT_CODE: 'COA_DUPLICATE_CODE',
  ACCOUNT_HAS_TRANSACTIONS: 'COA_HAS_TRANSACTIONS',
} as const;

export type CoaErrorCode = typeof COA_ERROR_CODES[keyof typeof COA_ERROR_CODES];

export interface CoaValidationError {
  code: CoaErrorCode;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

// Valid reference types for transactions
export const VALID_REFERENCE_TYPES = [
  'sale',
  'expense', 
  'adjustment',
  'transfer',
  'opening_balance',
  'journal_entry',
  'customer_balance',
  'supplier_payment',
  'cogs_consumption',
  'cogs_purchase',
] as const;

export type TransactionReferenceType = typeof VALID_REFERENCE_TYPES[number];

// Account type requirements by reference type
export const ACCOUNT_TYPE_REQUIREMENTS: Record<TransactionReferenceType, AccountType[]> = {
  sale: ['revenue', 'asset'],
  expense: ['expense', 'asset', 'liability'],
  adjustment: ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'],
  transfer: ['asset', 'liability'],
  opening_balance: ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'],
  journal_entry: ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'],
  customer_balance: ['asset', 'revenue'],
  supplier_payment: ['liability', 'asset', 'cogs'],
  cogs_consumption: ['cogs'],
  cogs_purchase: ['cogs'],
};

/**
 * Parse database error messages into explicit, user-friendly errors
 */
export function parseCoaError(error: Error | string): CoaValidationError {
  const message = typeof error === 'string' ? error : error.message;
  
  // Check for VALIDATION_ERROR prefix from triggers
  if (message.includes('VALIDATION_ERROR:')) {
    const cleanMessage = message.replace(/.*VALIDATION_ERROR:\s*/, '').replace(/\s*CONTEXT:.*/, '');
    
    if (cleanMessage.includes('does not exist in Chart of Accounts')) {
      return {
        code: COA_ERROR_CODES.MISSING_ACCOUNT,
        message: cleanMessage,
        field: 'account_id',
      };
    }
    
    if (cleanMessage.includes('is inactive')) {
      return {
        code: COA_ERROR_CODES.INACTIVE_ACCOUNT,
        message: cleanMessage,
        field: 'account_id',
      };
    }
    
    if (cleanMessage.includes('Cross-tenant transactions')) {
      return {
        code: COA_ERROR_CODES.CROSS_TENANT,
        message: cleanMessage,
        field: 'tenant_id',
      };
    }
    
    if (cleanMessage.includes('Invalid reference type')) {
      return {
        code: COA_ERROR_CODES.INVALID_REFERENCE_TYPE,
        message: cleanMessage,
        field: 'reference_type',
      };
    }
    
    if (cleanMessage.includes('must post to')) {
      return {
        code: COA_ERROR_CODES.INVALID_ACCOUNT_TYPE_MAPPING,
        message: cleanMessage,
        field: 'account_id',
      };
    }
    
    return {
      code: COA_ERROR_CODES.MISSING_ACCOUNT,
      message: cleanMessage,
    };
  }
  
  // Check for constraint violations
  if (message.includes('transaction_must_have_amount')) {
    return {
      code: COA_ERROR_CODES.MISSING_AMOUNT,
      message: 'Transaction must have a debit or credit amount greater than zero.',
      field: 'amount',
    };
  }
  
  if (message.includes('transaction_single_side')) {
    return {
      code: COA_ERROR_CODES.DOUBLE_ENTRY_VIOLATION,
      message: 'Transaction cannot have both debit and credit amounts. Use separate entries for double-entry bookkeeping.',
      field: 'amount',
    };
  }
  
  if (message.includes('valid_account_code_range')) {
    return {
      code: COA_ERROR_CODES.ACCOUNT_CODE_RANGE,
      message: 'Account code does not match the expected range for this account type.',
      field: 'account_code',
    };
  }
  
  if (message.includes('unique_account_code_per_tenant')) {
    return {
      code: COA_ERROR_CODES.DUPLICATE_ACCOUNT_CODE,
      message: 'An account with this code already exists in your organization.',
      field: 'account_code',
    };
  }
  
  if (message.includes('violates foreign key constraint') || message.includes('account_transactions_account_id_fkey')) {
    return {
      code: COA_ERROR_CODES.ACCOUNT_HAS_TRANSACTIONS,
      message: 'Cannot delete this account because it has existing transactions.',
      field: 'account_id',
    };
  }
  
  // Generic fallback
  return {
    code: COA_ERROR_CODES.MISSING_ACCOUNT,
    message: message || 'An unknown validation error occurred.',
  };
}

/**
 * Validate account type is appropriate for a given reference type
 */
export function validateAccountTypeForReference(
  accountType: AccountType,
  referenceType: TransactionReferenceType
): CoaValidationError | null {
  const allowedTypes = ACCOUNT_TYPE_REQUIREMENTS[referenceType];
  
  if (!allowedTypes.includes(accountType)) {
    const allowedLabels = allowedTypes.map(t => ACCOUNT_TYPE_LABELS[t]).join(', ');
    return {
      code: COA_ERROR_CODES.INVALID_ACCOUNT_TYPE_MAPPING,
      message: `${referenceType.replace('_', ' ')} transactions must use ${allowedLabels} accounts. Selected account is type "${ACCOUNT_TYPE_LABELS[accountType]}".`,
      field: 'account_id',
      details: {
        expected: allowedTypes,
        actual: accountType,
        referenceType,
      },
    };
  }
  
  return null;
}

/**
 * Validate account code is within the correct range for its type
 */
export function validateAccountCodeRange(
  accountCode: string,
  accountType: AccountType
): CoaValidationError | null {
  const range = ACCOUNT_CODE_RANGES[accountType];
  
  if (accountCode < range.min || accountCode >= range.max) {
    return {
      code: COA_ERROR_CODES.ACCOUNT_CODE_RANGE,
      message: `Account code "${accountCode}" is invalid for ${ACCOUNT_TYPE_LABELS[accountType]} accounts. Expected range: ${range.label}.`,
      field: 'account_code',
      details: {
        code: accountCode,
        type: accountType,
        expectedMin: range.min,
        expectedMax: range.max,
      },
    };
  }
  
  return null;
}

/**
 * Pre-validate transaction data before submission
 */
export function validateTransactionData(data: {
  account_id?: string;
  debit?: number;
  credit?: number;
  reference_type?: string;
}): CoaValidationError | null {
  // Must have an account
  if (!data.account_id) {
    return {
      code: COA_ERROR_CODES.MISSING_ACCOUNT,
      message: 'Please select a Chart of Accounts entry. Transactions cannot be saved without a CoA mapping.',
      field: 'account_id',
    };
  }
  
  // Must have amount
  const debit = data.debit || 0;
  const credit = data.credit || 0;
  
  if (debit <= 0 && credit <= 0) {
    return {
      code: COA_ERROR_CODES.MISSING_AMOUNT,
      message: 'Transaction must have a debit or credit amount greater than zero.',
      field: 'amount',
    };
  }
  
  // Can't have both
  if (debit > 0 && credit > 0) {
    return {
      code: COA_ERROR_CODES.DOUBLE_ENTRY_VIOLATION,
      message: 'Transaction cannot have both debit and credit amounts. Create separate entries for double-entry bookkeeping.',
      field: 'amount',
    };
  }
  
  // Validate reference type if provided
  if (data.reference_type && !VALID_REFERENCE_TYPES.includes(data.reference_type as TransactionReferenceType)) {
    return {
      code: COA_ERROR_CODES.INVALID_REFERENCE_TYPE,
      message: `Invalid reference type "${data.reference_type}". Allowed types: ${VALID_REFERENCE_TYPES.join(', ')}.`,
      field: 'reference_type',
    };
  }
  
  return null;
}

/**
 * Get human-readable explanation for an error code
 */
export function getErrorExplanation(code: CoaErrorCode): string {
  switch (code) {
    case COA_ERROR_CODES.MISSING_ACCOUNT:
      return 'Every transaction must be linked to an account in the Chart of Accounts. This ensures proper financial classification and reporting.';
    case COA_ERROR_CODES.INACTIVE_ACCOUNT:
      return 'Inactive accounts are closed for new transactions. Reactivate the account or choose an active alternative.';
    case COA_ERROR_CODES.CROSS_TENANT:
      return 'Transactions can only be posted to accounts within your organization for data security.';
    case COA_ERROR_CODES.INVALID_REFERENCE_TYPE:
      return 'The transaction type must be one of the predefined categories for proper audit trails.';
    case COA_ERROR_CODES.INVALID_ACCOUNT_TYPE_MAPPING:
      return 'Different transaction types must use appropriate account categories. For example, sales should credit Revenue accounts.';
    case COA_ERROR_CODES.MISSING_AMOUNT:
      return 'A transaction without an amount has no financial impact and cannot be recorded.';
    case COA_ERROR_CODES.DOUBLE_ENTRY_VIOLATION:
      return 'Double-entry bookkeeping requires separate debit and credit entries. Split this into two transactions.';
    case COA_ERROR_CODES.ACCOUNT_CODE_RANGE:
      return 'Account codes follow standardized ranges (e.g., Assets: 1000-1999, Expenses: 6000-6999) for consistent organization.';
    case COA_ERROR_CODES.DUPLICATE_ACCOUNT_CODE:
      return 'Each account must have a unique code within your organization to prevent confusion.';
    case COA_ERROR_CODES.ACCOUNT_HAS_TRANSACTIONS:
      return 'Accounts with transaction history cannot be deleted to maintain audit integrity. Deactivate instead.';
    default:
      return 'Please review the error details and correct the issue before saving.';
  }
}
