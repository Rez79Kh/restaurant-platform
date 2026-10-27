"use client";

import { useCallback, useEffect, useState } from "react";
import { ConnectionBanner } from "@/components/connection-banner";
import { LineActionStatus } from "@/components/line-action-status";
import { api } from "@/lib/client/api";
import type { LineStatus } from "@/lib/client/types";
import { useLineActions } from "@/lib/client/use-line-actions";
import { useLiveData } from "@/lib/client/use-live-data";
import { formatClock, formatLabel, formatNumber, minutesSince } from "@/lib/format";

type Ticket = {
  orderId: string;
  tableLabel: string | null;
  waitingSince: string;
  lines: { id: string; name: string; quantity: number; note: string | null; status: LineStatus; createdAt: string }[];
};

const NEXT: Partial<Record<LineStatus, { to: LineStatus; label: string }>> = {
  SENT: { to: "PREPARING", label: "شروع" },
  PREPARING: { to: "READY", label: "آماده شد" },
};

// Minutes waiting → urgency colour of the ticket.
const ageStyle = (minutes: number) =>
  minutes >= 20 ? "border-red-600 bg-red-50" : minutes >= 10 ? "border-amber-500 bg-amber-50" : "border-stone-300 bg-white";

export function KitchenBoard() {
  const load = useCallback(() => api<{ now: string; tickets: Ticket[] }>("/api/kitchen"), []);
  const { data, error, offline, reload } = useLiveData(load, (c) => c.lines.length > 0 || c.orders.length > 0);
  const { actions, move, retry, dismiss } = useLineActions(reload);

  // Re-render every 30 s so ticket ages keep counting without new data.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p className="text-stone-500">در حال بارگذاری…</p>;

  return (
    <div className="flex flex-col gap-4">
      <ConnectionBanner offline={offline} />
      {data.tickets.length === 0 && <p className="text-xl text-stone-500">سفارش در انتظاری نیست.</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.tickets.map((ticket) => {
          const age = minutesSince(ticket.waitingSince, clock);
          return (
            <article key={ticket.orderId} className={`flex flex-col gap-3 rounded-xl border-4 p-4 ${ageStyle(age)}`}>
              <header className="flex items-baseline justify-between">
                <h2 className="text-2xl font-bold">
                  {ticket.tableLabel ? `میز ${formatLabel(ticket.tableLabel)}` : "بیرون‌بر"}
                </h2>
                <span className="text-lg font-bold">{formatNumber(age)} دقیقه</span>
              </header>
              {ticket.lines.map((line) => {
                const next = NEXT[line.status];
                const action = actions[line.id];
                return (
                  <div key={line.id} className="rounded-lg bg-white/80 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className={line.status === "VOID" ? "text-red-700 line-through" : ""}>
                        <p className="text-lg font-bold">
                          {line.name} × {formatNumber(line.quantity)}
                        </p>
                        {line.note && <p className="font-bold text-amber-800">{line.note}</p>}
                        <p className="text-xs text-stone-500">{formatClock(line.createdAt)}</p>
                      </div>
                      {line.status === "VOID" && <span className="font-bold text-red-700">لغو شد</span>}
                      {line.status === "READY" && <span className="text-green-700">آماده — منتظر سرو</span>}
                      {next && (
                        <button
                          onClick={() => move(line.id, line.status, next.to)}
                          disabled={action?.status === "pending"}
                          className={`min-h-14 min-w-28 rounded-xl px-4 text-lg font-bold text-white disabled:opacity-50 ${
                            line.status === "SENT" ? "bg-stone-900" : "bg-green-700"
                          }`}
                        >
                          {action?.status === "pending" ? "…" : next.label}
                        </button>
                      )}
                    </div>
                    <LineActionStatus action={action} onRetry={() => retry(line.id)} onDismiss={() => dismiss(line.id)} />
                  </div>
                );
              })}
            </article>
          );
        })}
      </div>
    </div>
  );
}
