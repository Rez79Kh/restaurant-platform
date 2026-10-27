import type { DraftItem, DraftWarning, MenuDraft, ModelMenu } from "./menu-schema";

// Sanity checks on extracted prices. The manager reviews every row anyway;
// these make the likely mistakes impossible to miss.
//
// Plausible single-item price in a café or restaurant, late 1405, in Toman.
export const PRICE_MIN_TOMAN = 5_000;
export const PRICE_MAX_TOMAN = 5_000_000;

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

export function toDraft(menu: ModelMenu): MenuDraft {
  const flat = menu.categories.flatMap((c) => c.items.map((i) => ({ category: c.name, name: i.name, price: i.price })));
  if (flat.length === 0) return { items: [], warnings: ["EMPTY"] };

  const typical = median(flat.map((i) => i.price ?? 0).filter((p) => p > 0));
  const warnings: MenuDraft["warnings"] = [];
  let scale = 1;
  let perItem: DraftWarning | null = null;

  if (menu.currency === "RIAL") {
    // The menu says ریال: Toman is a tenth.
    scale = 0.1;
    perItem = "PRICE_FROM_RIAL";
    warnings.push("CONVERTED_FROM_RIAL");
  } else if (menu.currency === "THOUSAND_TOMAN" || (typical > 0 && typical < 1_000)) {
    // "۱۲۰" on an Iranian menu almost always means ۱۲۰ هزار تومان.
    scale = 1_000;
    perItem = "PRICE_FROM_THOUSANDS";
    warnings.push("CONVERTED_FROM_THOUSANDS");
  } else if (typical > PRICE_MAX_TOMAN / 2) {
    // Not stated, but prices this high are more likely Rial. Flag; don't guess.
    warnings.push("POSSIBLY_RIAL");
  }

  const seen = new Set<string>();
  const items: DraftItem[] = flat.map((raw) => {
    const itemWarnings: DraftWarning[] = [];
    let priceToman: number | null = null;
    if (raw.price === null || raw.price === 0) {
      itemWarnings.push("PRICE_MISSING");
    } else {
      priceToman = Math.round(raw.price * scale);
      if (perItem) itemWarnings.push(perItem);
      if (priceToman < PRICE_MIN_TOMAN || priceToman > PRICE_MAX_TOMAN) itemWarnings.push("PRICE_OUT_OF_RANGE");
    }
    const key = `${raw.category}|${raw.name}`;
    if (seen.has(key)) itemWarnings.push("DUPLICATE");
    seen.add(key);
    return { category: raw.category, name: raw.name, priceToman, printedPrice: raw.price, warnings: itemWarnings };
  });

  return { items, warnings };
}
