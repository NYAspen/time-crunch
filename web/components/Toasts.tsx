"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ActionResult } from "@/lib/types";

// Pop-down notifications pinned to the top of the screen, styled like the
// station service-alert signs (coloured icon block, short heading, message, ×).
// Used on the team page for action results and for things other teams or the
// admin did (see app/team/EventFeed.tsx). Anyone can call showToast /
// showResult; <Toasts /> shows them.

export type ToastTone = "green" | "red" | "orange" | "purple" | "black";

export type Toast = {
  id: number;
  tone: ToastTone;
  icon: string;
  title: string;
  message: string;
};

const ICON_BG: Record<ToastTone, string> = {
  green: "bg-green-600",
  red: "bg-red-600",
  orange: "bg-orange-600",
  purple: "bg-purple-600",
  black: "bg-gray-900",
};
const EDGE: Record<ToastTone, string> = {
  green: "border-green-600",
  red: "border-red-600",
  orange: "border-orange-600",
  purple: "border-purple-600",
  black: "border-gray-900",
};
const TITLE: Record<ToastTone, string> = {
  green: "text-green-700",
  red: "text-red-700",
  orange: "text-orange-700",
  purple: "text-purple-700",
  black: "text-gray-700",
};

const MAX_SHOWN = 3;
const FADE_MS = 500;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(toast: Omit<Toast, "id">) {
  // Newest on top; the oldest drop off so the stack never covers the screen.
  toasts = [{ ...toast, id: nextId++ }, ...toasts].slice(0, MAX_SHOWN);
  emit();
}

function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

// ---------------------------------------------------------------------------
// Action results. A result the team can undo is shown in the Undo bar instead
// (one "Done + Undo" message, not two): the bar picks it up with
// attachPendingUndo. If no Undo shows up within a few seconds, it pops
// down here after all, so a message is never lost.
// ---------------------------------------------------------------------------

let pendingUndo: { message: string; timer: ReturnType<typeof setTimeout> } | null = null;

export function showResult(result: ActionResult, options: { undoable?: boolean } = {}) {
  if (!result) return;
  if (!result.ok) {
    showToast({ tone: "red", icon: "!", title: "Problem", message: result.message });
    return;
  }
  if (options.undoable) {
    if (pendingUndo) {
      clearTimeout(pendingUndo.timer);
      showToast({ tone: "green", icon: "✓", title: "Done", message: pendingUndo.message });
    }
    const message = result.message;
    pendingUndo = {
      message,
      timer: setTimeout(() => {
        pendingUndo = null;
        emit();
        showToast({ tone: "green", icon: "✓", title: "Done", message });
      }, 3000),
    };
    emit();
    return;
  }
  showToast({ tone: "green", icon: "✓", title: "Done", message: result.message });
}

// Messages already given to an Undo bar, by undo id.
let undoMessages: Record<string, string> = {};
const noUndoMessages: Record<string, string> = {};

export function attachPendingUndo(undoId: string) {
  if (!pendingUndo) return;
  clearTimeout(pendingUndo.timer);
  undoMessages = { ...undoMessages, [undoId]: pendingUndo.message };
  pendingUndo = null;
  emit();
}

// True while an undoable result is waiting for its Undo bar.
export function usePendingUndo() {
  return useSyncExternalStore(subscribe, () => pendingUndo !== null, () => false);
}

export function useUndoMessages() {
  return useSyncExternalStore(subscribe, () => undoMessages, () => noUndoMessages);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const noToasts: Toast[] = [];

export function Toasts() {
  const shown = useSyncExternalStore(subscribe, () => toasts, () => noToasts);
  if (shown.length === 0) return null;
  return (
    <section
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-30 mx-auto max-w-lg space-y-2 px-4"
      style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
    >
      {shown.map((t) => (
        <ToastBox key={t.id} toast={t} />
      ))}
    </section>
  );
}

function ToastBox({ toast }: { toast: Toast }) {
  const [fading, setFading] = useState(false);

  // Fades out by itself: good news after 5 s, anything else after 8 s.
  useEffect(() => {
    const showFor = toast.tone === "green" ? 5000 : 8000;
    const fadeTimer = setTimeout(() => setFading(true), showFor);
    const hideTimer = setTimeout(() => dismissToast(toast.id), showFor + FADE_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [toast]);

  return (
    <div
      role="status"
      className={`tc-drop pointer-events-auto flex items-stretch overflow-hidden border-2 bg-white text-gray-900 shadow-lg transition-opacity duration-500 ${
        EDGE[toast.tone]
      } ${fading ? "opacity-0" : "opacity-100"}`}
    >
      <span
        aria-hidden
        className={`flex w-10 shrink-0 items-center justify-center text-xl font-black text-white ${ICON_BG[toast.tone]}`}
      >
        {toast.icon}
      </span>
      <span className="min-w-0 flex-1 px-3 py-2">
        <span className={`block text-xs font-bold uppercase tracking-wider ${TITLE[toast.tone]}`}>{toast.title}</span>
        {toast.message}
      </span>
      <button
        type="button"
        aria-label="Close message"
        onClick={() => dismissToast(toast.id)}
        className="shrink-0 px-3 text-xl leading-none text-gray-500 hover:text-gray-900"
      >
        ×
      </button>
    </div>
  );
}
