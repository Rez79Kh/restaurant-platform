"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { Menu } from "@/lib/client/types";
import { useAction } from "@/lib/client/use-action";
import { toAsciiDigits } from "@/lib/digits";
import { formatNumber, formatToman } from "@/lib/format";

type Row = { category: string; name: string; price: string; warnings: string[] };
type Draft = { draftId: string; items: { category: string; name: string; priceToman: number | null; warnings: string[] }[]; warnings: string[] };

const ROW_WARNINGS: Record<string, string> = {
  PRICE_MISSING: "قیمت خوانده نشد",
  PRICE_FROM_THOUSANDS: "قیمت به هزار تومان نوشته شده بود؛ ×۱۰۰۰ شد",
  PRICE_FROM_RIAL: "قیمت به ریال بود؛ ÷۱۰ شد",
  PRICE_OUT_OF_RANGE: "قیمت غیرعادی است",
  DUPLICATE: "تکراری",
};
const MENU_WARNINGS: Record<string, string> = {
  CONVERTED_FROM_RIAL: "منو به ریال بود و قیمت‌ها به تومان تبدیل شد. همه را بررسی کنید.",
  CONVERTED_FROM_THOUSANDS: "قیمت‌ها به هزار تومان نوشته شده بود و در ۱۰۰۰ ضرب شد. همه را بررسی کنید.",
  POSSIBLY_RIAL: "قیمت‌ها خیلی بالاست؛ شاید منو به ریال باشد.",
  EMPTY: "آیتمی در عکس پیدا نشد. عکس واضح‌تری بگیرید یا دستی وارد کنید.",
};

const parsePrice = (text: string) => {
  const clean = toAsciiDigits(text).replace(/[,٬\s]/g, "");
  return /^\d+$/.test(clean) ? Number(clean) : NaN;
};
const rowValid = (r: Row) => r.category.trim() !== "" && r.name.trim() !== "" && parsePrice(r.price) >= 1_000;

/** Shrink to ≤1600 px JPEG before upload: faster on weak connections, cheaper to read. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.85),
    );
  } catch {
    return file; // the server still checks type and size
  }
}

export function MenuImport() {
  const [stage, setStage] = useState<"pick" | "uploading" | "review" | "done">("pick");
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [menuWarnings, setMenuWarnings] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [summary, setSummary] = useState<{ created: number; updated: number } | null>(null);
  const save = useAction();

  useEffect(() => {
    api<Menu>("/api/menu")
      .then((m) => setCategories(m.categories.map((c) => c.name)))
      .catch(() => {});
  }, []);

  async function upload(picked: File) {
    setFile(picked);
    setStage("uploading");
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("image", await shrink(picked), "menu.jpg");
      const res = await fetch("/api/menu-imports", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? "خواندن منو انجام نشد.");
      const draft = body as Draft;
      setDraftId(draft.draftId);
      setMenuWarnings(draft.warnings);
      setRows(draft.items.map((i) => ({ category: i.category, name: i.name, price: i.priceToman === null ? "" : String(i.priceToman), warnings: i.warnings })));
      setStage("review");
    } catch (e) {
      setUploadError(e instanceof TypeError ? "اتصال برقرار نشد. اینترنت را بررسی کنید." : (e as Error).message);
      setStage("pick");
    }
  }

  function manual() {
    setDraftId(null);
    setMenuWarnings([]);
    setRows([{ category: categories[0] ?? "", name: "", price: "", warnings: [] }]);
    setStage("review");
  }

  function edit(next: Row[]) {
    setRows(next);
    save.reset();
  }

  async function confirm() {
    const result = await save.run((key) =>
      api<{ created: number; updated: number }>("/api/menu-imports/confirm", {
        method: "POST",
        idempotencyKey: key,
        body: {
          draftId,
          items: rows.map((r) => ({ category: r.category.trim(), name: r.name.trim(), priceToman: parsePrice(r.price) })),
        },
      }),
    );
    if (result) {
      setSummary(result);
      setStage("done");
    }
  }

  const cell = "w-full rounded border border-stone-300 bg-white px-2 py-2";

  if (stage === "done" && summary) {
    return (
      <div className="flex flex-col gap-3 rounded-xl bg-green-50 p-4">
        <p className="font-bold">منو ذخیره شد.</p>
        <p>{formatNumber(summary.created)} آیتم جدید اضافه شد و قیمت {formatNumber(summary.updated)} آیتم به‌روز شد.</p>
        <Link href="/" className="self-start rounded-lg bg-stone-900 px-4 py-2 text-white">بازگشت به میزها</Link>
      </div>
    );
  }

  if (stage === "pick" || stage === "uploading") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-stone-600">
          از منوی چاپی عکس بگیرید. آیتم‌ها و قیمت‌ها به صورت پیش‌نویس نمایش داده می‌شوند و تا شما تأیید نکنید چیزی در منو ذخیره نمی‌شود.
        </p>
        <label className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-stone-400 bg-white p-8 ${stage === "uploading" ? "opacity-60" : ""}`}>
          <span className="text-lg font-bold">{stage === "uploading" ? "در حال خواندن منو… (تا ۲۰ ثانیه)" : "انتخاب یا گرفتن عکس منو"}</span>
          <span className="text-sm text-stone-500">JPEG، PNG یا WebP — حداکثر ۴ مگابایت</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={stage === "uploading"}
            className="sr-only"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </label>
        {uploadError && (
          <div role="alert" className="flex flex-col gap-2 rounded-lg bg-red-50 p-3 text-red-800">
            <span>{uploadError}</span>
            <div className="flex gap-2">
              {file && <button onClick={() => upload(file)} className="rounded border border-current px-3 py-1">دوباره</button>}
              <button onClick={manual} className="rounded bg-red-700 px-3 py-1 text-white">ورود دستی</button>
            </div>
          </div>
        )}
        <button onClick={manual} className="self-start text-sm underline">بدون عکس، دستی وارد می‌کنم</button>
      </div>
    );
  }

  const valid = rows.length > 0 && rows.every(rowValid);
  return (
    <div className="flex flex-col gap-3">
      {menuWarnings.map((w) => (
        <div key={w} className="flex items-center justify-between gap-2 rounded-lg bg-amber-100 p-3 text-sm">
          <span>{MENU_WARNINGS[w] ?? w}</span>
          {w === "POSSIBLY_RIAL" && (
            <button
              onClick={() => edit(rows.map((r) => ({ ...r, price: Number.isNaN(parsePrice(r.price)) ? r.price : String(Math.round(parsePrice(r.price) / 10)) })))}
              className="shrink-0 rounded border border-current px-2 py-1"
            >
              تبدیل همه ÷۱۰
            </button>
          )}
        </div>
      ))}
      <p className="text-sm text-stone-600">همهٔ ردیف‌ها را بررسی کنید. قیمت‌ها به تومان است.</p>
      <datalist id="categories">
        {[...new Set([...categories, ...rows.map((r) => r.category)])].map((c) => <option key={c} value={c} />)}
      </datalist>
      {rows.map((row, i) => (
        <div key={i} className={`flex flex-col gap-1 rounded-lg p-2 ${rowValid(row) ? "bg-white" : "bg-red-50"}`}>
          <div className="grid grid-cols-[1fr_1fr_8rem_auto] items-center gap-2">
            <input list="categories" value={row.category} placeholder="دسته" className={cell} onChange={(e) => edit(rows.map((r, j) => (j === i ? { ...r, category: e.target.value } : r)))} />
            <input value={row.name} placeholder="نام آیتم" className={cell} onChange={(e) => edit(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} />
            <input value={row.price} placeholder="قیمت" inputMode="numeric" dir="ltr" className={cell} onChange={(e) => edit(rows.map((r, j) => (j === i ? { ...r, price: e.target.value } : r)))} />
            <button onClick={() => edit(rows.filter((_, j) => j !== i))} className="px-2 text-red-700">حذف</button>
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            {!Number.isNaN(parsePrice(row.price)) && <span className="text-stone-500">{formatToman(parsePrice(row.price))}</span>}
            {row.warnings.map((w) => <span key={w} className="rounded bg-amber-200 px-2">{ROW_WARNINGS[w] ?? w}</span>)}
          </div>
        </div>
      ))}
      <button onClick={() => edit([...rows, { category: rows.at(-1)?.category ?? "", name: "", price: "", warnings: [] }])} className="self-start rounded-lg border border-stone-400 px-3 py-2">
        + ردیف جدید
      </button>
      {save.state.status === "failed" && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">
          <span>ذخیره نشد: {save.state.error}</span>
          {!save.state.refused && <button onClick={confirm} className="rounded border border-current px-2 py-1">دوباره</button>}
        </div>
      )}
      <button
        onClick={confirm}
        disabled={!valid || save.state.status === "pending"}
        className="rounded-xl bg-stone-900 py-3 text-lg font-bold text-white disabled:opacity-40"
      >
        {save.state.status === "pending" ? "در حال ذخیره…" : `تأیید و ذخیره در منو (${formatNumber(rows.length)} آیتم)`}
      </button>
    </div>
  );
}
