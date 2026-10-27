"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConnectionBanner } from "@/components/connection-banner";
import { LineActionStatus } from "@/components/line-action-status";
import { CancelOrderButton, canVoid, CheckoutPanel, DiscountPanel, VoidLineForm } from "@/components/order-actions";
import { api, ApiError, newIdempotencyKey } from "@/lib/client/api";
import type { Line, Menu, OrderView } from "@/lib/client/types";
import { useLineActions, type LineAction } from "@/lib/client/use-line-actions";
import { useLiveData } from "@/lib/client/use-live-data";
import { formatClock, formatLabel, formatNumber, formatToman, LINE_STATUS_LABELS } from "@/lib/format";

const QUICK_NOTES = ["بدون شکر", "کم‌شیرین", "شیر بادام", "یخ کم", "سس جدا", "بدون پیاز", "برای بیرون‌بر"];

type CartItem = { menuItemId: string; name: string; priceToman: number; quantity: number; note: string };
// The key lives as long as the cart is unchanged: "retry" resends the exact
// same request; editing the cart makes it a new request with a new key.
type Send = { status: "idle" | "sending" | "failed"; key: string | null; error?: string };

const STATUS_STYLE: Record<string, string> = {
  SENT: "bg-stone-200",
  PREPARING: "bg-amber-200",
  READY: "bg-green-600 text-white",
  SERVED: "bg-stone-100 text-stone-500",
  VOID: "bg-red-100 text-red-800 line-through",
};

export function OrderScreen({ orderId, role }: { orderId: string; role: "MANAGER" | "STAFF" }) {
  const router = useRouter();
  const load = useCallback(() => api<OrderView>(`/api/orders/${orderId}`), [orderId]);
  const { data, error, offline, reload } = useLiveData(
    load,
    (c) => c.orders.some((o) => o.id === orderId) || c.lines.some((l) => l.orderId === orderId),
  );
  const lineActions = useLineActions(reload);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [send, setSend] = useState<Send>({ status: "idle", key: null });
  const [checkout, setCheckout] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);

  useEffect(() => {
    api<Menu>("/api/menu")
      .then((m) => {
        setMenu(m);
        setCategoryId((current) => current ?? m.categories[0]?.id ?? null);
      })
      .catch(() => setMenu(null));
  }, []);

  function editCart(change: (items: CartItem[]) => CartItem[]) {
    setCart((items) => change(items).filter((i) => i.quantity > 0));
    setSend({ status: "idle", key: null });
  }

  function addToCart(item: { id: string; name: string; priceToman: number }) {
    editCart((items) => {
      const existing = items.find((i) => i.menuItemId === item.id && i.note === "");
      if (existing) return items.map((i) => (i === existing ? { ...i, quantity: i.quantity + 1 } : i));
      return [...items, { menuItemId: item.id, name: item.name, priceToman: item.priceToman, quantity: 1, note: "" }];
    });
  }

  async function sendCart() {
    const key = send.key ?? newIdempotencyKey();
    setSend({ status: "sending", key });
    try {
      await api(`/api/orders/${orderId}/lines`, {
        method: "POST",
        idempotencyKey: key,
        body: { items: cart.map(({ menuItemId, quantity, note }) => ({ menuItemId, quantity, note: note || undefined })) },
      });
      setCart([]);
      setSend({ status: "idle", key: null });
      await reload();
    } catch (e) {
      setSend({ status: "failed", key, error: (e as ApiError).message });
    }
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p className="text-stone-500">در حال بارگذاری…</p>;

  const { order, lines, bill } = data;
  const isOpen = order.status === "OPEN";
  const busy = send.status === "sending";
  const category = menu?.categories.find((c) => c.id === categoryId);

  return (
    <div className="flex flex-col gap-4 pb-48">
      <header className="flex items-center justify-between">
        <Link href="/" className="rounded-lg border border-stone-300 px-3 py-2">→ میزها</Link>
        <div className="text-end">
          <h1 className="text-xl font-bold">{order.tableLabel ? `میز ${formatLabel(order.tableLabel)}` : "بیرون‌بر"}</h1>
          <p className="text-sm text-stone-500">باز شده {formatClock(order.openedAt)}</p>
        </div>
      </header>
      <ConnectionBanner offline={offline} />
      {!isOpen && <p className="rounded-lg bg-stone-200 p-3">این سفارش {order.status === "SETTLED" ? "تسویه" : "لغو"} شده است.</p>}

      <section className="flex flex-col gap-2">
        {lines.length === 0 && <p className="text-stone-500">هنوز آیتمی ثبت نشده است.</p>}
        {lines.map((line) => (
          <LineRow
            key={line.id}
            line={line}
            action={lineActions.actions[line.id]}
            onServe={isOpen ? () => lineActions.move(line.id, "READY", "SERVED") : undefined}
            onRetry={() => lineActions.retry(line.id)}
            onDismiss={() => lineActions.dismiss(line.id)}
            onVoid={isOpen && canVoid(line, role) ? () => setVoiding(voiding === line.id ? null : line.id) : undefined}
            voidForm={voiding === line.id ? <VoidLineForm line={line} onClose={() => setVoiding(null)} reload={reload} /> : null}
          />
        ))}
      </section>

      <section className="flex flex-col gap-1 rounded-xl bg-white p-3 text-sm">
        <Row label="جمع" value={formatToman(bill.subtotalToman)} />
        {bill.discountToman > 0 && <Row label={`تخفیف (${order.discountReason ?? ""})`} value={`− ${formatToman(bill.discountToman)}`} />}
        {bill.serviceChargeToman > 0 && <Row label="حق سرویس" value={formatToman(bill.serviceChargeToman)} />}
        <Row label="مالیات بر ارزش افزوده" value={formatToman(bill.vatToman)} />
        <Row label="مبلغ قابل پرداخت" value={formatToman(bill.totalToman)} strong />
      </section>

      {isOpen && role === "MANAGER" && <DiscountPanel view={data} reload={reload} />}
      {isOpen && lines.every((l) => l.status === "VOID") && (
        <CancelOrderButton view={data} onCancelled={() => router.push("/")} reload={reload} />
      )}
      {isOpen && lines.some((l) => l.status !== "VOID") && cart.length === 0 && (
        checkout ? (
          <CheckoutPanel view={data} onSettled={() => router.push("/")} reload={reload} />
        ) : (
          <button onClick={() => setCheckout(true)} className="rounded-xl bg-green-700 py-3 text-lg font-bold text-white">
            تسویه حساب
          </button>
        )
      )}

      {isOpen && menu && (
        <section className="flex flex-col gap-3">
          <nav className="flex gap-2 overflow-x-auto pb-1">
            {menu.categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategoryId(c.id)}
                className={`shrink-0 rounded-full px-4 py-2 ${c.id === categoryId ? "bg-stone-900 text-white" : "bg-white"}`}
              >
                {c.name}
              </button>
            ))}
          </nav>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {category?.items.map((item) => (
              <button
                key={item.id}
                onClick={() => addToCart(item)}
                disabled={!item.isAvailable || busy}
                className="flex min-h-20 flex-col justify-between rounded-xl border border-stone-200 bg-white p-3 text-start disabled:opacity-40"
              >
                <span className="font-bold">{item.name}</span>
                <span className="text-sm text-stone-600">{item.isAvailable ? formatToman(item.priceToman) : "ناموجود"}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {isOpen && cart.length > 0 && (
        <section className="fixed inset-x-0 bottom-0 flex max-h-[60vh] flex-col gap-2 overflow-y-auto border-t border-stone-300 bg-stone-50 p-3 shadow-lg">
          {cart.map((item, index) => (
            <div key={index} className="flex flex-col gap-1 rounded-lg bg-white p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{item.name}</span>
                <div className="flex items-center gap-2">
                  <button disabled={busy} className="h-10 w-10 rounded-lg border" onClick={() => editCart((c) => c.map((i, j) => (j === index ? { ...i, quantity: i.quantity - 1 } : i)))}>−</button>
                  <span className="w-6 text-center">{formatNumber(item.quantity)}</span>
                  <button disabled={busy} className="h-10 w-10 rounded-lg border" onClick={() => editCart((c) => c.map((i, j) => (j === index ? { ...i, quantity: Math.min(20, i.quantity + 1) } : i)))}>+</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {QUICK_NOTES.map((n) => (
                  <button
                    key={n}
                    disabled={busy}
                    onClick={() => editCart((c) => c.map((i, j) => (j === index ? { ...i, note: toggleNote(i.note, n) } : i)))}
                    className={`rounded-full px-2 py-1 text-xs ${item.note.split("، ").includes(n) ? "bg-stone-900 text-white" : "bg-stone-100"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <input
                value={item.note}
                maxLength={120}
                disabled={busy}
                onChange={(e) => editCart((c) => c.map((i, j) => (j === index ? { ...i, note: e.target.value } : i)))}
                placeholder="یادداشت برای آشپزخانه"
                className="rounded border border-stone-200 px-2 py-1 text-sm"
              />
            </div>
          ))}
          {send.status === "failed" && (
            <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-800">
              ارسال نشد: {send.error} — سفارش‌ها هنوز اینجا هستند؛ دوباره ارسال کنید.
            </p>
          )}
          <button
            onClick={sendCart}
            disabled={busy}
            className="rounded-xl bg-stone-900 py-3 text-lg font-bold text-white disabled:opacity-60"
          >
            {busy ? "در حال ارسال…" : send.status === "failed" ? "ارسال دوباره" : `ارسال به آشپزخانه (${formatNumber(cart.reduce((n, i) => n + i.quantity, 0))})`}
          </button>
        </section>
      )}
    </div>
  );
}

function toggleNote(current: string, note: string): string {
  const parts = current ? current.split("، ").filter(Boolean) : [];
  const next = parts.includes(note) ? parts.filter((p) => p !== note) : [...parts, note];
  return next.join("، ").slice(0, 120);
}

function LineRow({
  line,
  action,
  onServe,
  onRetry,
  onDismiss,
  onVoid,
  voidForm,
}: {
  line: Line;
  action: LineAction | undefined;
  onServe?: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  onVoid?: () => void;
  voidForm: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className={line.status === "VOID" ? "line-through text-stone-400" : ""}>
            {line.name} × {formatNumber(line.quantity)}
          </span>
          {line.note && <span className="text-sm text-stone-500">{line.note}</span>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[line.status]}`}>
            {LINE_STATUS_LABELS[line.status]}
          </span>
          {line.unitPriceToman !== undefined && (
            <span className="text-xs text-stone-500">{formatToman(line.unitPriceToman * line.quantity)}</span>
          )}
          {line.status === "READY" && onServe && (
            <button
              onClick={onServe}
              disabled={action?.status === "pending"}
              className="min-h-11 rounded-lg bg-green-700 px-4 font-bold text-white disabled:opacity-50"
            >
              {action?.status === "pending" ? "…" : "سرو شد"}
            </button>
          )}
          {onVoid && (
            <button onClick={onVoid} className="text-xs text-red-700 underline">
              لغو
            </button>
          )}
        </div>
      </div>
      <LineActionStatus action={action} onRetry={onRetry} onDismiss={onDismiss} />
      {voidForm}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t border-stone-200 pt-1 text-base font-bold" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
