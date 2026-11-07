"use client";

import { useEffect, useState } from "react";

// True only once `flag` has stayed true for a few seconds. Different tables can
// load at different moments on a slow network, so a mismatch between them is only
// worth showing if it lasts.
export function useSettled(flag: boolean, ms = 3000) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!flag) return;
    const id = setTimeout(() => setSettled(true), ms);
    return () => {
      clearTimeout(id);
      setSettled(false);
    };
  }, [flag, ms]);
  return flag && settled;
}
