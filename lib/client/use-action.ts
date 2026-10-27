"use client";

import { useState } from "react";
import { ApiError, newIdempotencyKey } from "./api";

type ActionState = { status: "idle" | "pending" | "failed"; key: string | null; error?: string; refused?: boolean };

/**
 * One user action that mutates something, with visible pending/failed state.
 * The idempotency key is kept across retries only when the outcome is unknown
 * (network failure, 5xx): the server may have applied it, so the retry must
 * be the SAME request. A 4xx means the server answered "no"; trying again
 * is a new request with a new key. Changing the inputs should call reset().
 */
export function useAction() {
  const [state, setState] = useState<ActionState>({ status: "idle", key: null });

  async function run<T>(request: (key: string) => Promise<T>): Promise<T | undefined> {
    const key = state.key ?? newIdempotencyKey();
    setState({ status: "pending", key });
    try {
      const result = await request(key);
      setState({ status: "idle", key: null });
      return result;
    } catch (e) {
      const err = e as ApiError;
      const unknownOutcome = err.status === 0 || err.status >= 500;
      setState({ status: "failed", key: unknownOutcome ? key : null, error: err.message, refused: !unknownOutcome });
      return undefined;
    }
  }

  return { state, run, reset: () => setState({ status: "idle", key: null }) };
}
