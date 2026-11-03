import type { ReactNode } from "react";

// Station-name sign at the top of the home and login pages: a small
// "Jet Lag: Chicago" line over the page title, on a black sign with a
// Purple Line bar.
export function PageSign({ title, large }: { title: ReactNode; large?: boolean }) {
  return (
    <div className={`border-t-8 border-purple-600 bg-gray-900 px-4 text-white ${large ? "pt-4 pb-5" : "py-3"}`}>
      <div className="text-xs font-bold tracking-[0.2em] text-gray-300 uppercase">Jet Lag: Chicago</div>
      <h1 className={`mt-1 leading-none ${large ? "text-5xl" : "text-3xl"}`}>{title}</h1>
    </div>
  );
}
