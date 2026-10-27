import { z } from "zod";
import { toAsciiDigits } from "@/lib/digits";

// What the model must return. Anything else (extra keys, prose, a different
// shape) is rejected or stripped: the model can only ever hand us data in
// this exact form.

/** Lenient on how a number is written ("۱۲۰٬۰۰۰", "120,000"); anything else → null. */
const price = z.preprocess((value) => {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const clean = toAsciiDigits(value).replace(/[,٬\s]/g, "");
  return /^\d+(\.\d+)?$/.test(clean) ? Number(clean) : null;
}, z.number().nonnegative().finite().nullable());

export const ModelMenu = z.object({
  // How prices are written on the menu, as the model read it.
  currency: z.enum(["TOMAN", "THOUSAND_TOMAN", "RIAL", "UNKNOWN"]).catch("UNKNOWN"),
  categories: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        items: z
          .array(z.object({ name: z.string().trim().min(1).max(80), price: price.catch(null) }))
          .max(150),
      }),
    )
    .max(40),
});
export type ModelMenu = z.infer<typeof ModelMenu>;

export type DraftWarning =
  | "PRICE_MISSING"
  | "PRICE_FROM_THOUSANDS" // printed as thousands (۱۲۰ → ۱۲۰٬۰۰۰); scaled ×1000
  | "PRICE_FROM_RIAL" // printed in Rial; divided by 10
  | "PRICE_OUT_OF_RANGE"
  | "DUPLICATE";

export type DraftItem = {
  category: string;
  name: string;
  priceToman: number | null;
  /** The number as the model read it, before any unit conversion. */
  printedPrice: number | null;
  warnings: DraftWarning[];
};

export type MenuDraft = {
  items: DraftItem[];
  /** Whole-menu findings, e.g. "prices look like Rial" or "nothing found". */
  warnings: ("CONVERTED_FROM_RIAL" | "CONVERTED_FROM_THOUSANDS" | "POSSIBLY_RIAL" | "EMPTY")[];
};
