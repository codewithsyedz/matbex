export function canAddInventory(hasRole: (role: string) => boolean): boolean {
  return ["owner", "manager", "accountant", "superadmin"].some(hasRole);
}

export function correctedExpenseVat(amount: number, originalAmount: number, originalVat: number): number {
  if (originalAmount <= 0 || originalVat <= 0) return 0;
  return Math.round(amount * originalVat / originalAmount * 100) / 100;
}

export function correctedExpenseTotals(amount: number, originalAmount: number, originalVat: number) {
  const vat = correctedExpenseVat(amount, originalAmount, originalVat);
  return { vat, net: Math.round((amount - vat) * 100) / 100 };
}