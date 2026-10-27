// The bill calculation. Pure, no imports: used by the API, the UI and the seed.
//
// Order of operations (fixed):
//   subtotal  = Σ unit price × quantity over non-void lines
//   discount  = AMOUNT: the amount, capped at the subtotal
//               PERCENT: subtotal × rate
//   service   = (subtotal − discount) × service rate
//   VAT       = (subtotal − discount + service) × VAT rate
//   total     = subtotal − discount + service + VAT
//
// VAT is charged on the service charge too: the service charge is part of
// what the guest pays for. All amounts are integer Toman. Every step rounds
// half-up to a whole Toman, using integer arithmetic (no floating point).
// Rates are basis points: 1000 = 10%.

export type BillLine = {
  unitPriceToman: number;
  quantity: number;
  status: string; // lines with status "VOID" are excluded
};

export type BillDiscount =
  | { type: "AMOUNT"; value: number } // Toman
  | { type: "PERCENT"; value: number }; // basis points

export type BillInput = {
  lines: readonly BillLine[];
  discount: BillDiscount | null;
  serviceChargeBp: number;
  vatRateBp: number;
};

export type Bill = {
  subtotalToman: number;
  discountToman: number;
  serviceChargeToman: number;
  vatToman: number;
  totalToman: number;
};

/** amount × bp / 10000, rounded half-up. Inputs are non-negative integers. */
export function applyRate(amount: number, bp: number): number {
  return Math.floor((amount * bp + 5000) / 10000);
}

export function calculateBill(input: BillInput): Bill {
  const subtotalToman = input.lines
    .filter((line) => line.status !== "VOID")
    .reduce((sum, line) => sum + line.unitPriceToman * line.quantity, 0);

  let discountToman = 0;
  if (input.discount?.type === "AMOUNT") {
    discountToman = Math.min(input.discount.value, subtotalToman);
  } else if (input.discount?.type === "PERCENT") {
    discountToman = applyRate(subtotalToman, input.discount.value);
  }

  const afterDiscount = subtotalToman - discountToman;
  const serviceChargeToman = applyRate(afterDiscount, input.serviceChargeBp);
  const vatToman = applyRate(afterDiscount + serviceChargeToman, input.vatRateBp);

  return {
    subtotalToman,
    discountToman,
    serviceChargeToman,
    vatToman,
    totalToman: afterDiscount + serviceChargeToman + vatToman,
  };
}
