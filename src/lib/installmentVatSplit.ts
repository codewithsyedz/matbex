/**
 * Mirrors the `create_installment_plan` VAT/fee split performed in the database
 * so the UI can preview exactly what will be posted to the ledger.
 *
 * Posting shape:
 *   DR asset / expense      net goods value
 *   DR 1180 Input VAT       recoverable VAT (goods + optional fee VAT)
 *   DR 6850 Finance charges net finance charge
 *       CR 2450 BNPL Payable  gross total payable
 */
export interface InstallmentSplit {
  netAsset: number;
  goodsVat: number;
  financeNet: number;
  financeVat: number;
  recoverableVat: number;
  totalPayable: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function splitInstallmentPurchase(params: {
  price: number;
  financeCharge?: number;
  vatPercent?: number;
  priceIncludesVat?: boolean;
  vatOnFinanceCharge?: boolean;
}): InstallmentSplit {
  const price = Number(params.price) || 0;
  const rate = (Number(params.vatPercent) || 0) / 100;
  const inclusive = !!params.priceIncludesVat;
  let fee = r2(Number(params.financeCharge) || 0);

  let netAsset: number;
  let goodsVat = 0;
  if (rate > 0 && inclusive) {
    netAsset = r2(price / (1 + rate));
    goodsVat = r2(price - netAsset);
  } else if (rate > 0) {
    netAsset = r2(price);
    goodsVat = r2(price * rate);
  } else {
    netAsset = r2(price);
  }

  let financeVat = 0;
  if (rate > 0 && params.vatOnFinanceCharge && fee > 0) {
    if (inclusive) {
      financeVat = r2(fee - fee / (1 + rate));
      fee = r2(fee - financeVat);
    } else {
      financeVat = r2(fee * rate);
    }
  }

  return {
    netAsset,
    goodsVat,
    financeNet: fee,
    financeVat,
    recoverableVat: r2(goodsVat + financeVat),
    totalPayable: r2(netAsset + goodsVat + fee + financeVat),
  };
}
