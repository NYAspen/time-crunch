"use client";

import { useEffect, useRef, useState } from "react";
import { useOffline } from "@/lib/connection";

// Countdown speed with ▲ / ▼ arrows: each tap moves the speed by 1×.
// Taps show straight away; after a short pause they are sent together as one
// change (so fast tapping never makes the screen lag behind the server).
// `dark` is for use on the black countdown sign.
export const MIN_SPEED = -20;
export const MAX_SPEED = 20;
const SEND_AFTER_MS = 450;

// The speed tile's colours, like a line-colour sign: blue = clock stopped or
// going up, white/black = normal, orange = draining fast.
function tileClass(speed: number, dark: boolean) {
  if (speed <= 0) return dark ? "border-sky-400 bg-sky-400 text-gray-900" : "border-blue-600 bg-blue-600 text-white";
  if (speed >= 2) return "border-orange-600 bg-orange-600 text-white";
  return dark ? "border-white bg-white text-gray-900" : "border-gray-900 bg-gray-900 text-white";
}

export function SpeedStepper({
  speed,
  disabled,
  onChange,
  vertical = false,
  dark = false,
}: {
  speed: number; // the speed the server last reported
  disabled?: boolean;
  onChange: (delta: number) => Promise<number | null>; // returns the new speed, or null if it failed
  vertical?: boolean; // ▲ above the speed, ▼ below (next to the countdown)
  dark?: boolean;
}) {
  // With no connection a tap may or may not arrive, so tapping again could shift
  // the speed twice. The arrows wait until the real speed has reloaded.
  const offline = useOffline();
  const locked = disabled || offline;
  // While taps are waiting or being sent, show the speed they add up to.
  const [shown, setShown] = useState<number | null>(null);
  const [idle, setIdle] = useState(true);
  const queued = useRef(0);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Once the live data has caught up, go back to showing it.
  if (shown !== null && idle && speed === shown) setShown(null);
  const value = shown ?? speed;

  const flush = async () => {
    if (busy.current) return; // sent when the current one finishes
    const delta = queued.current;
    queued.current = 0;
    if (delta === 0) {
      setShown(null);
      setIdle(true);
      return;
    }
    busy.current = true;
    const result = await onChange(delta);
    busy.current = false;
    if (queued.current !== 0) {
      flush();
      return;
    }
    setShown(result);
    setIdle(true);
    // Safety net: if something else (a curse) changed the speed meanwhile,
    // stop showing our number after a few seconds.
    setTimeout(() => {
      if (!busy.current && queued.current === 0) setShown(null);
    }, 3000);
  };

  const tap = (delta: -1 | 1) => {
    const next = Math.min(MAX_SPEED, Math.max(MIN_SPEED, value + delta));
    if (next === value) return;
    queued.current += next - value;
    setShown(next);
    setIdle(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SEND_AFTER_MS);
  };

  // Small arrows either side of the speed tile. Vertical ones are 32px tall
  // (under the usual 36px minimum, globals.css) but full tile width, so still easy to tap.
  const arrow = `flex items-center justify-center border-2 text-xs leading-none disabled:opacity-30 ${
    vertical ? "h-8 min-h-0 w-12" : "h-9 w-9"
  } ${dark ? "border-white/50 bg-transparent text-white active:bg-white/20" : "border-gray-900 bg-white text-gray-900 active:bg-gray-200"}`;

  const up = (
    <button
      type="button"
      aria-label="Faster: speed up 1×"
      disabled={locked || value >= MAX_SPEED}
      onClick={() => tap(1)}
      className={arrow}
    >
      ▲
    </button>
  );
  const down = (
    <button
      type="button"
      aria-label="Slower: speed down 1×"
      disabled={locked || value <= MIN_SPEED}
      onClick={() => tap(-1)}
      className={arrow}
    >
      ▼
    </button>
  );
  const tile = (
    <span
      className={`flex items-center justify-center border-2 font-extrabold tabular-nums transition-opacity ${
        vertical ? "my-1 h-9 w-12 text-lg" : "mx-1 h-9 w-12 text-base"
      } ${tileClass(value, dark)} ${idle ? "" : "opacity-60"}`}
    >
      {value}×
    </span>
  );

  return vertical ? (
    <div className="flex shrink-0 flex-col items-center">
      {up}
      {tile}
      {down}
    </div>
  ) : (
    <div className="flex items-center gap-1">
      {down}
      {tile}
      {up}
    </div>
  );
}
