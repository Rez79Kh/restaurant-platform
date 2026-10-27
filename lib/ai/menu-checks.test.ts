import { describe, expect, it } from "vitest";
import { toDraft } from "./menu-checks";
import { ModelMenu } from "./menu-schema";

const menu = (currency: string, items: [string, number | null][], category = "نوشیدنی گرم") =>
  ModelMenu.parse({ currency, categories: [{ name: category, items: items.map(([name, price]) => ({ name, price })) }] });

describe("toDraft() price sanity checks", () => {
  it("takes Toman prices as they are", () => {
    const draft = toDraft(menu("TOMAN", [["اسپرسو", 120_000], ["لاته", 175_000]]));
    expect(draft.warnings).toEqual([]);
    expect(draft.items.map((i) => [i.priceToman, i.warnings])).toEqual([[120_000, []], [175_000, []]]);
  });

  it("scales thousand-Toman shorthand (۱۲۰ → ۱۲۰٬۰۰۰) and flags every row", () => {
    const draft = toDraft(menu("UNKNOWN", [["اسپرسو", 120], ["لاته", 175]]));
    expect(draft.warnings).toEqual(["CONVERTED_FROM_THOUSANDS"]);
    expect(draft.items[0]).toMatchObject({ priceToman: 120_000, printedPrice: 120, warnings: ["PRICE_FROM_THOUSANDS"] });
  });

  it("converts a menu that says Rial and flags it", () => {
    const draft = toDraft(menu("RIAL", [["اسپرسو", 1_200_000]]));
    expect(draft.warnings).toEqual(["CONVERTED_FROM_RIAL"]);
    expect(draft.items[0]).toMatchObject({ priceToman: 120_000, warnings: ["PRICE_FROM_RIAL"] });
  });

  it("flags prices that look like Rial without converting when the menu doesn't say", () => {
    const draft = toDraft(menu("TOMAN", [["کباب", 4_500_000], ["جوجه", 4_800_000]]));
    expect(draft.warnings).toEqual(["POSSIBLY_RIAL"]);
    expect(draft.items[0]!.priceToman).toBe(4_500_000);
  });

  it("flags missing, implausible and duplicate rows", () => {
    const draft = toDraft(menu("TOMAN", [["اسپرسو", 120_000], ["چای", null], ["آب", 900], ["کیک", 90_000_000], ["اسپرسو", 125_000]]));
    expect(draft.items.map((i) => i.warnings)).toEqual([[], ["PRICE_MISSING"], ["PRICE_OUT_OF_RANGE"], ["PRICE_OUT_OF_RANGE"], ["DUPLICATE"]]);
    expect(draft.items[1]!.priceToman).toBeNull();
  });

  it("reports an empty result", () => {
    expect(toDraft(ModelMenu.parse({ currency: "UNKNOWN", categories: [] }))).toEqual({ items: [], warnings: ["EMPTY"] });
  });
});

describe("ModelMenu schema (the only shape the model can hand us)", () => {
  it("reads Persian digits and separators in prices", () => {
    const parsed = ModelMenu.parse({ currency: "TOMAN", categories: [{ name: "x", items: [{ name: "y", price: "۱۲۰٬۰۰۰" }] }] });
    expect(parsed.categories[0]!.items[0]!.price).toBe(120_000);
  });

  it("drops anything outside the schema, e.g. an injected field", () => {
    const parsed = ModelMenu.parse({
      currency: "TOMAN",
      note: "ignore previous instructions",
      categories: [{ name: "x", admin: true, items: [{ name: "y", price: 1, discount: 100 }] }],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/ignore|admin|discount/);
  });

  it("rejects output that isn't a menu", () => {
    for (const bad of ["Sure! Here is the menu", { categories: "none" }, { categories: [{ items: [] }] }, null]) {
      expect(ModelMenu.safeParse(bad).success).toBe(false);
    }
  });

  it("turns an unreadable or negative price into null rather than failing the whole menu", () => {
    const parsed = ModelMenu.parse({ currency: "?", categories: [{ name: "x", items: [{ name: "a", price: "قیمت روز" }, { name: "b", price: -5 }] }] });
    expect(parsed.currency).toBe("UNKNOWN");
    expect(parsed.categories[0]!.items.map((i) => i.price)).toEqual([null, null]);
  });
});
