"use client";

import { useCallback, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Changes } from "./types";
import { usePolling } from "./use-polling";

/**
 * A snapshot that stays fresh: load it once, then poll /api/changes with the
 * snapshot's cursor and reload whenever something relevant changed. Changes
 * are treated as "reload", never merged, which keeps every screen consistent
 * with the server at the cost of one extra request per change.
 */
export function useLiveData<T extends { now: string }>(
  load: () => Promise<T>,
  isRelevant: (changes: Changes) => boolean,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const cursor = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const fresh = await load();
    cursor.current = fresh.now;
    setData(fresh);
    setError(null);
  }, [load]);

  // The first tick runs immediately and loads the snapshot.
  usePolling(async () => {
    try {
      if (!cursor.current) {
        await reload();
      } else {
        const changes = await api<Changes>(`/api/changes?since=${encodeURIComponent(cursor.current)}`);
        if (changes.resync || isRelevant(changes)) await reload();
        else cursor.current = changes.now;
      }
      setOffline(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setOffline(true);
      else if (!cursor.current) setError((e as Error).message);
    }
  });

  return { data, error, offline, reload };
}
