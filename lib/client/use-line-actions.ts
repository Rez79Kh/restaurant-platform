"use client";

import { useState } from "react";
import { LINE_STATUS_LABELS } from "@/lib/format";
import { api, ApiError, newIdempotencyKey } from "./api";
import type { LineStatus } from "./types";

export type LineAction = {
  status: "pending" | "failed" | "conflict";
  from: LineStatus;
  to: LineStatus;
  key: string;
  message?: string;
};

/**
 * Status moves for order lines, with explicit states per line:
 *  - pending: request in flight (button disabled)
 *  - failed: network/server error → "retry" resends the SAME key, so a move
 *    that did reach the server is not applied twice
 *  - conflict (409): someone else changed the line first → show the current
 *    state and refresh. Never retried automatically, never overwritten.
 */
export function useLineActions(refresh: () => Promise<void>) {
  const [actions, setActions] = useState<Record<string, LineAction>>({});
  const set = (lineId: string, action: LineAction | null) =>
    setActions((all) => {
      const next = { ...all };
      if (action) next[lineId] = action;
      else delete next[lineId];
      return next;
    });

  async function move(lineId: string, from: LineStatus, to: LineStatus, key = newIdempotencyKey()) {
    set(lineId, { status: "pending", from, to, key });
    try {
      await api(`/api/order-lines/${lineId}/status`, { method: "POST", body: { from, to }, idempotencyKey: key });
      set(lineId, null);
      await refresh().catch(() => {});
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409) {
        const current = (err.details as { line?: { status?: string } } | undefined)?.line?.status;
        set(lineId, {
          status: "conflict",
          from,
          to,
          key,
          message: current ? `${err.message} وضعیت فعلی: ${LINE_STATUS_LABELS[current]}` : err.message,
        });
        await refresh().catch(() => {});
      } else {
        set(lineId, { status: "failed", from, to, key, message: err.message });
      }
    }
  }

  return {
    actions,
    move,
    retry: (lineId: string) => {
      const a = actions[lineId];
      if (a) void move(lineId, a.from, a.to, a.key);
    },
    dismiss: (lineId: string) => set(lineId, null),
  };
}
