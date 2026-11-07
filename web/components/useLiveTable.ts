"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { RECONNECTED_EVENT } from "@/lib/connection";
import { createClient } from "@/lib/supabase/client";

const REFRESH_EVENT = "live-tables-refresh";

// Call after any action that changes data, so every live section on the page
// (clock, board, history…) reloads now instead of waiting for the sync message.
export function refreshAllLiveTables() {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

// Wraps a form action (for useActionState) so live sections reload once it finishes.
export function withRefresh<S>(action: (prev: S, formData: FormData) => Promise<S>) {
  return async (prev: S, formData: FormData) => {
    const result = await action(prev, formData);
    refreshAllLiveTables();
    return result;
  };
}

// ---------------------------------------------------------------------------
// One shared sync connection per browser tab (see migration 0010).
// The database broadcasts "table X changed" (no data) on the public topic
// "game-sync"; every section showing table X then reloads it, and the normal
// privacy rules decide what it gets back. One connection instead of one per
// section per table keeps Supabase fast with many phones open.
// ---------------------------------------------------------------------------

const reloadersByTable = new Map<string, Set<() => void>>();
let syncChannel: RealtimeChannel | null = null;
let connectedBefore = false;
const changedTables = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function onTableChanged(table: string) {
  // One action can change several tables in quick succession: gather them for
  // a moment so each section reloads once.
  changedTables.add(table);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    for (const t of changedTables) reloadersByTable.get(t)?.forEach((reload) => reload());
    changedTables.clear();
  }, 100);
}

function ensureSyncChannel() {
  if (syncChannel) return;
  syncChannel = createClient()
    .channel("game-sync")
    .on("broadcast", { event: "changed" }, ({ payload }) => {
      if (typeof payload?.table === "string") onTableChanged(payload.table);
    })
    .subscribe((status) => {
      // After a reconnect, reload everything: messages sent while offline are lost.
      if (status === "SUBSCRIBED") {
        if (connectedBefore) refreshAllLiveTables();
        connectedBefore = true;
      }
    });
}

// Loads data with `load`, then reloads it whenever the given table changes in
// the database. Also reloads when the phone wakes up, reconnects, after the
// page's own actions, and every 20 s as a safety net.
export function useLiveTable<T>(table: string, load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  // Several reloads can overlap; only the newest one may update the screen,
  // otherwise a slow, older reply could overwrite fresher data.
  const latestRequest = useRef(0);
  const mounted = useRef(true);
  const loadedOnce = useRef(false);

  const refresh = useCallback(() => {
    const requestId = ++latestRequest.current;
    loadRef
      .current()
      .then((result) => {
        if (mounted.current && requestId === latestRequest.current) {
          loadedOnce.current = true;
          setData(result);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        // A failed reload (usually a signal drop) keeps the last good data on
        // screen: the connection banner says it may be out of date.
        if (loadedOnce.current) {
          console.warn(`Could not reload ${table}:`, e);
        } else if (mounted.current && requestId === latestRequest.current) {
          setError(e instanceof Error ? e.message : "Could not load data");
        }
      });
  }, [table]);

  useEffect(() => {
    mounted.current = true;
    ensureSyncChannel();

    let reloaders = reloadersByTable.get(table);
    if (!reloaders) reloadersByTable.set(table, (reloaders = new Set()));
    reloaders.add(refresh);

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    window.addEventListener(REFRESH_EVENT, refresh);
    window.addEventListener(RECONNECTED_EVENT, refresh);
    const poll = setInterval(refresh, 20000);

    refresh();

    return () => {
      mounted.current = false;
      reloaders.delete(refresh);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      window.removeEventListener(REFRESH_EVENT, refresh);
      window.removeEventListener(RECONNECTED_EVENT, refresh);
      clearInterval(poll);
    };
  }, [table, refresh]);

  return { data, error, refresh };
}
