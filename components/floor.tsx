"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { ConnectionBanner } from "@/components/connection-banner";
import { api, ApiError, newIdempotencyKey } from "@/lib/client/api";
import type { Floor, OrderSummary } from "@/lib/client/types";
import { useLiveData } from "@/lib/client/use-live-data";
import { formatLabel, formatNumber, minutesSince } from "@/lib/format";

type Opening = { tableId: string | null; key: string; error?: string };

export function FloorView() {
  const router = useRouter();
  const load = useCallback(() => api<Floor>("/api/floor"), []);
  const { data, error, offline, reload } = useLiveData(
    load,
    (c) => c.orders.length > 0 || c.lines.length > 0,
  );
  const [opening, setOpening] = useState<Opening | null>(null);

  // The key is created once per tap and reused on retry, so a request that
  // reached the server before the connection dropped is not applied twice.
  async function open(tableId: string | null, key = newIdempotencyKey()) {
    setOpening({ tableId, key });
    try {
      const res = await api<{ order: { id: string } }>("/api/orders", {
        method: "POST",
        body: { tableId },
        idempotencyKey: key,
      });
      router.push(`/orders/${res.order.id}`);
    } catch (e) {
      const err = e as ApiError;
      const existing = (err.details as { orderId?: string } | undefined)?.orderId;
      if (err.status === 409 && existing) return router.push(`/orders/${existing}`);
      if (err.status === 409) {
        setOpening(null);
        await reload();
        return;
      }
      setOpening({ tableId, key, error: err.message });
    }
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p className="text-stone-500">در حال بارگذاری…</p>;

  return (
    <div className="flex flex-col gap-4">
      <ConnectionBanner offline={offline} />
      {opening?.error && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg bg-red-50 p-3 text-red-800">
          <span>باز کردن سفارش انجام نشد: {opening.error}</span>
          <button
            className="rounded-lg bg-red-700 px-3 py-2 text-white"
            onClick={() => open(opening.tableId, opening.key)}
          >
            دوباره
          </button>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {data.tables.map((table) =>
          table.order ? (
            <Link
              key={table.id}
              href={`/orders/${table.order.id}`}
              className={`flex min-h-28 flex-col justify-between rounded-xl border-2 p-3 ${
                table.order.counts.READY > 0 ? "border-green-600 bg-green-50" : "border-amber-500 bg-amber-50"
              }`}
            >
              <span className="text-xl font-bold">میز {formatLabel(table.label)}</span>
              <OrderBadges order={table.order} />
            </Link>
          ) : (
            <button
              key={table.id}
              onClick={() => open(table.id)}
              disabled={opening !== null && !opening.error}
              className="flex min-h-28 flex-col justify-between rounded-xl border-2 border-stone-200 bg-white p-3 text-start disabled:opacity-50"
            >
              <span className="text-xl font-bold">میز {formatLabel(table.label)}</span>
              <span className="text-sm text-stone-500">
                {opening?.tableId === table.id && !opening.error
                  ? "در حال باز کردن…"
                  : `خالی · ${formatNumber(table.seats)} نفر`}
              </span>
            </button>
          ),
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">بیرون‌بر</h2>
          <button
            onClick={() => open(null)}
            disabled={opening !== null && !opening.error}
            className="rounded-lg bg-stone-900 px-4 py-2 text-white disabled:opacity-50"
          >
            {opening?.tableId === null && !opening.error ? "در حال ثبت…" : "سفارش بیرون‌بر جدید"}
          </button>
        </div>
        {data.takeaways.map((t) => (
          <Link key={t.id} href={`/orders/${t.id}`} className="flex items-center justify-between rounded-xl border-2 border-stone-200 bg-white p-3">
            <span>بیرون‌بر</span>
            <OrderBadges order={t} />
          </Link>
        ))}
      </section>
    </div>
  );
}

function OrderBadges({ order }: { order: OrderSummary }) {
  const inKitchen = order.counts.SENT + order.counts.PREPARING;
  return (
    <span className="flex flex-wrap gap-1 text-sm">
      {order.counts.READY > 0 && (
        <span className="rounded bg-green-600 px-2 py-0.5 text-white">{formatNumber(order.counts.READY)} آماده</span>
      )}
      {inKitchen > 0 && <span className="rounded bg-amber-200 px-2 py-0.5">{formatNumber(inKitchen)} در آشپزخانه</span>}
      <span className="text-stone-500">{formatNumber(minutesSince(order.openedAt))} دقیقه</span>
    </span>
  );
}
