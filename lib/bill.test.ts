import { describe, expect, it } from "vitest";
import { applyRate, calculateBill, type BillLine } from "./bill";

const line = (unitPriceToman: number, quantity = 1, status = "SERVED"): BillLine => ({
  unitPriceToman,
  quantity,
  status,
});

describe("calculateBill()", () => {
  it("applies discount → service charge → VAT in that order", () => {
    // 2 × 175,000 + 210,000 = 560,000
    // 10% discount = 56,000 → 504,000
    // service 5% of 504,000 = 25,200
    // VAT 10% of 529,200 = 52,920
    expect(
      calculateBill({
        lines: [line(175_000, 2), line(210_000)],
        discount: { type: "PERCENT", value: 1000 },
        serviceChargeBp: 500,
        vatRateBp: 1000,
      }),
    ).toEqual({
      subtotalToman: 560_000,
      discountToman: 56_000,
      serviceChargeToman: 25_200,
      vatToman: 52_920,
      totalToman: 582_120,
    });
  });

  it("excludes void lines", () => {
    const bill = calculateBill({
      lines: [line(120_000), line(500_000, 1, "VOID")],
      discount: null,
      serviceChargeBp: 0,
      vatRateBp: 1000,
    });
    expect(bill.subtotalToman).toBe(120_000);
    expect(bill.totalToman).toBe(132_000);
  });

  it("caps an amount discount at the subtotal; the total never goes negative", () => {
    const bill = calculateBill({
      lines: [line(50_000)],
      discount: { type: "AMOUNT", value: 80_000 },
      serviceChargeBp: 1000,
      vatRateBp: 1000,
    });
    expect(bill).toEqual({
      subtotalToman: 50_000,
      discountToman: 50_000,
      serviceChargeToman: 0,
      vatToman: 0,
      totalToman: 0,
    });
  });

  it("a percent discount follows items added after it was applied", () => {
    const discount = { type: "PERCENT", value: 1000 } as const;
    const before = calculateBill({ lines: [line(100_000)], discount, serviceChargeBp: 0, vatRateBp: 0 });
    const after = calculateBill({
      lines: [line(100_000), line(100_000)],
      discount,
      serviceChargeBp: 0,
      vatRateBp: 0,
    });
    expect([before.discountToman, after.discountToman]).toEqual([10_000, 20_000]);
  });

  it("rounds half-up to a whole Toman at each step", () => {
    // 12.5% of 1,004 = 125.5 → 126; VAT 9% of 878 = 79.02 → 79
    const bill = calculateBill({
      lines: [line(1_004)],
      discount: { type: "PERCENT", value: 1250 },
      serviceChargeBp: 0,
      vatRateBp: 900,
    });
    expect(bill.discountToman).toBe(126);
    expect(bill.vatToman).toBe(79);
    expect(bill.totalToman).toBe(1_004 - 126 + 79);
  });

  it("is zero for an empty order", () => {
    expect(
      calculateBill({ lines: [], discount: null, serviceChargeBp: 1000, vatRateBp: 1000 }).totalToman,
    ).toBe(0);
  });
});

describe("applyRate()", () => {
  it("rounds exact halves up and stays exact for large bills", () => {
    expect(applyRate(5, 1000)).toBe(1); // 0.5 → 1
    expect(applyRate(4, 1000)).toBe(0); // 0.4 → 0
    expect(applyRate(987_654_321, 1000)).toBe(98_765_432); // .1 → down
  });
});
