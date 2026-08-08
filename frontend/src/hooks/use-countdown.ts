"use client";

import { useState, useEffect, useCallback } from "react";

export function useCountdown(expiresAt: number | null | undefined) {
  const [seconds, setSeconds] = useState(0);

  const calculate = useCallback(() => {
    if (!expiresAt) return 0;
    const now = Math.floor(Date.now() / 1000);
    return Math.max(0, expiresAt - now);
  }, [expiresAt]);

  useEffect(() => {
    setSeconds(calculate());
    const id = setInterval(() => setSeconds(calculate()), 1000);
    return () => clearInterval(id);
  }, [calculate]);

  return seconds;
}
