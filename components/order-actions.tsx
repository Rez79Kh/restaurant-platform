"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import type { Line, OrderView } from "@/lib/client/types";
import { useAction } from "@/lib/client/use-action";
import { toAsciiDigits } from "@/lib/digits";
import { formatNumber, formatToman } from "@/lib/format";

type Role = "MANAGER" | "STAFF" | "KITCHEN";

const METHODS = [
  { id: "CARD_READER", label: "کارتخوان" },
  { id: "CASH", label: "نقد" },
  { id: "CARD_TRANSFER", label: "کارت به کارت" },
] as const;
type Method = (typeof METHODS)[number]["id"];

const VOID_REASONS = ["مشتری منصرف شد", "اشتباه در ثبت", "تأخیر زیاد آشپزخانه", "مواد اولیه تمام شد"];
const DISCOUNT_REASONS = ["مشتری دائمی", "تأخیر در سرو", "جبران اشتباه", "تخفیف همکار"];

/** "۱۲۵٬۰۰۰" or "125,000" → 125000; anything else → NaN. */
const parseAmount = (text: string) => {
  const clean = toAsciiDigits(text).replace(/[,٬\s]/g, "");
  return /^\d+$/.test(clean) ? Number(clean) : NaN;
};

const input = "rounded-lg border border-stone-300 bg-white px-3 py-2";

function Failure({ error, retryable, onRetry }: { error?: string; retryable: boolean; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">
      <span>{error}</span>
      {retryable && (
        <button className="shrink-0 rounded border border-current px-2 py-1" onClick={onRetry}>
          دوباره
        </button>
      )}
    </div>
  );
}

// Checkout ----------------------------------------------------------------------

export function CheckoutPanel({ view, onSettled, reload }: { view: OrderView; onSettled: () => void; reload: () => Promise<void> }) {
  const total = view.bill.totalToman;
  const [entries, setEntries] = useState<{ method: Method; amount: string }[]>([]);
  const action = useAction();

  const amounts = entries.map((e) => parseAmount(e.amount));
  const paid = amounts.reduce((s, n) => s + (Number.isNaN(n) ? 0 : n), 0);
  const remaining = total - paid;
  const valid = amounts.every((n) => n > 0) && (entries.length > 0 || total === 0);
  const unserved = view.lines.filter((l) => l.status === "SENT" || l.status === "PREPARING" || l.status === "READY").length;

  function edit(next: { method: Method; amount: string }[]) {
    setEntries(next);
    action.reset();
  }
  const add = (method: Method) => edit([...entries, { method, amount: String(Math.max(remaining, 0)) }]);
  const splitEvenly = (people: number) => {
    const share = Math.floor(total / people / 1000) * 1000;
    edit(Array.from({ length: people }, (_, i) => ({
      method: "CARD_READER" as Method,
      amount: String(i === people - 1 ? total - share * (people - 1) : share),
    })));
  };

  async function submit() {
    const done = await action.run((key) =>
      api(`/api/orders/${view.order.id}/settle`, {
        method: "POST",
        idempotencyKey: key,
        body: { version: view.order.version, payments: entries.map((e, i) => ({ method: e.method, amountToman: amounts[i] })) },
      }),
    );
    if (done) onSettled();
    else await reload().catch(() => {}); // a refusal (409/422) means the bill changed: show the new one
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border-2 border-stone-900 bg-white p-3">
      <h2 className="text-lg font-bold">پرداخت — {formatToman(total)}</h2>
      {unserved > 0 && (
        <p className="rounded bg-amber-100 p-2 text-sm">{formatNumber(unserved)} آیتم هنوز سرو نشده است.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {METHODS.map((m) => (
          <button key={m.id} onClick={() => add(m.id)} className="rounded-lg bg-stone-100 px-3 py-2">+ {m.label}</button>
        ))}
        {[2, 3, 4].map((n) => (
          <button key={n} onClick={() => splitEvenly(n)} className="rounded-lg bg-stone-100 px-3 py-2">
            تقسیم {formatNumber(n)} نفره
          </button>
        ))}
      </div>
      {entries.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <select
            value={entry.method}
            onChange={(e) => edit(entries.map((x, j) => (j === i ? { ...x, method: e.target.value as Method } : x)))}
            className={input}
          >
            {METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <input
            value={entry.amount}
            inputMode="numeric"
            dir="ltr"
            onChange={(e) => edit(entries.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
            className={`${input} w-36 ${Number.isNaN(amounts[i]!) || amounts[i] === 0 ? "border-red-500" : ""}`}
          />
          <button onClick={() => edit(entries.filter((_, j) => j !== i))} className="px-2 text-red-700">حذف</button>
        </div>
      ))}
      <p className={`font-bold ${remaining === 0 ? "text-green-700" : "text-red-700"}`}>
        {remaining === 0 ? "مبلغ کامل است." : remaining > 0 ? `باقیمانده: ${formatToman(remaining)}` : `بیشتر از مبلغ: ${formatToman(-remaining)}`}
      </p>
      {action.state.status === "failed" && (
        <Failure error={action.state.error} retryable={!action.state.refused} onRetry={submit} />
      )}
      <button
        onClick={submit}
        disabled={remaining !== 0 || !valid || action.state.status === "pending"}
        className="rounded-xl bg-green-700 py-3 text-lg font-bold text-white disabled:opacity-40"
      >
        {action.state.status === "pending" ? "در حال ثبت…" : "ثبت پرداخت و بستن حساب"}
      </button>
    </section>
  );
}

// Discount (manager) ------------------------------------------------------------

export function DiscountPanel({ view, reload }: { view: OrderView; reload: () => Promise<void> }) {
  const [type, setType] = useState<"PERCENT" | "AMOUNT">("PERCENT");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const action = useAction();
  const has = view.order.discountType !== null;

  // Percent is entered as a percentage (12.5) and sent as basis points (1250).
  const parsed = type === "PERCENT" ? Math.round(Number(toAsciiDigits(value).replace("٫", ".")) * 100) : parseAmount(value);
  const canApply = Number.isFinite(parsed) && parsed > 0 && reason.trim().length >= 2;

  async function send(discount: { type: string; value: number } | null) {
    const done = await action.run((key) =>
      api(`/api/orders/${view.order.id}/discount`, {
        method: "POST",
        idempotencyKey: key,
        body: { version: view.order.version, discount, reason: reason.trim() },
      }),
    );
    if (done) {
      setValue("");
      setReason("");
    }
    await reload().catch(() => {});
  }

  const editing = (f: () => void) => {
    f();
    action.reset();
  };

  return (
    <section className="flex flex-col gap-2 rounded-xl bg-white p-3">
      <h2 className="font-bold">تخفیف (مدیر)</h2>
      <div className="flex gap-2">
        {(["PERCENT", "AMOUNT"] as const).map((t) => (
          <button key={t} onClick={() => editing(() => setType(t))} className={`rounded-lg px-3 py-2 ${type === t ? "bg-stone-900 text-white" : "bg-stone-100"}`}>
            {t === "PERCENT" ? "درصدی" : "مبلغی"}
          </button>
        ))}
        <input
          value={value}
          onChange={(e) => editing(() => setValue(e.target.value))}
          inputMode="decimal"
          dir="ltr"
          placeholder={type === "PERCENT" ? "۱۰" : "۵۰۰۰۰"}
          className={`${input} w-28`}
        />
        <span className="self-center text-sm">{type === "PERCENT" ? "٪" : "تومان"}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {DISCOUNT_REASONS.map((r) => (
          <button key={r} onClick={() => editing(() => setReason(r))} className={`rounded-full px-2 py-1 text-xs ${reason === r ? "bg-stone-900 text-white" : "bg-stone-100"}`}>{r}</button>
        ))}
      </div>
      <input value={reason} onChange={(e) => editing(() => setReason(e.target.value))} placeholder="دلیل (الزامی)" className={input} />
      {action.state.status === "failed" && (
        <Failure error={action.state.error} retryable={!action.state.refused} onRetry={() => send(has && !canApply ? null : { type, value: parsed })} />
      )}
      <div className="flex gap-2">
        <button
          onClick={() => send({ type, value: parsed })}
          disabled={!canApply || action.state.status === "pending"}
          className="flex-1 rounded-lg bg-stone-900 py-2 text-white disabled:opacity-40"
        >
          {action.state.status === "pending" ? "…" : has ? "تغییر تخفیف" : "اعمال تخفیف"}
        </button>
        {has && (
          <button
            onClick={() => send(null)}
            disabled={reason.trim().length < 2 || action.state.status === "pending"}
            className="rounded-lg border border-red-700 px-3 py-2 text-red-700 disabled:opacity-40"
          >
            حذف تخفیف
          </button>
        )}
      </div>
    </section>
  );
}

// Void a line ---------------------------------------------------------------------

/** Staff may void items the kitchen hasn't started; managers any billable item. */
export const canVoid = (line: Line, role: Role) =>
  line.status !== "VOID" && (role === "MANAGER" || (role === "STAFF" && line.status === "SENT"));

export function VoidLineForm({ line, onClose, reload }: { line: Line; onClose: () => void; reload: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const action = useAction();

  async function submit() {
    const done = await action.run((key) =>
      api(`/api/order-lines/${line.id}/void`, { method: "POST", idempotencyKey: key, body: { from: line.status, reason: reason.trim() } }),
    );
    await reload().catch(() => {});
    if (done) onClose();
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg bg-red-50 p-2">
      <div className="flex flex-wrap gap-1">
        {VOID_REASONS.map((r) => (
          <button key={r} onClick={() => { setReason(r); action.reset(); }} className={`rounded-full px-2 py-1 text-xs ${reason === r ? "bg-red-700 text-white" : "bg-white"}`}>{r}</button>
        ))}
      </div>
      <input value={reason} onChange={(e) => { setReason(e.target.value); action.reset(); }} placeholder="دلیل لغو (الزامی)" className={input} />
      {action.state.status === "failed" && <Failure error={action.state.error} retryable={!action.state.refused} onRetry={submit} />}
      <div className="flex gap-2">
        <button onClick={submit} disabled={reason.trim().length < 2 || action.state.status === "pending"} className="flex-1 rounded-lg bg-red-700 py-2 text-white disabled:opacity-40">
          {action.state.status === "pending" ? "…" : "لغو آیتم"}
        </button>
        <button onClick={onClose} className="rounded-lg border px-3 py-2">انصراف</button>
      </div>
    </div>
  );
}

// Cancel an empty order ---------------------------------------------------------------

export function CancelOrderButton({ view, onCancelled, reload }: { view: OrderView; onCancelled: () => void; reload: () => Promise<void> }) {
  const action = useAction();
  async function cancel() {
    const done = await action.run((key) =>
      api(`/api/orders/${view.order.id}/void`, {
        method: "POST",
        idempotencyKey: key,
        body: { version: view.order.version, reason: "سفارش خالی / میز اشتباه" },
      }),
    );
    if (done) onCancelled();
    else await reload().catch(() => {});
  }
  return (
    <div className="flex flex-col gap-2">
      {action.state.status === "failed" && <Failure error={action.state.error} retryable={!action.state.refused} onRetry={cancel} />}
      <button onClick={cancel} disabled={action.state.status === "pending"} className="rounded-lg border border-stone-400 py-2 text-stone-700">
        {action.state.status === "pending" ? "…" : "لغو سفارش (میز اشتباه)"}
      </button>
    </div>
  );
}
