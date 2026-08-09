"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface TimerCardProps {
  timeRemaining: number | null;
  remainingMs?: number;
  totalTimeMs?: number;
  message?: string | null;
}

export function TimerCard({
  timeRemaining,
  remainingMs,
  totalTimeMs = 60_000,
  message = null,
}: TimerCardProps) {
  const numericTimeRemaining = typeof timeRemaining === "number" ? timeRemaining : 0;
  const normalizedTimeRemaining =
    Number.isFinite(numericTimeRemaining) && numericTimeRemaining > 0
      ? Math.min(Math.floor(numericTimeRemaining), 86_400)
      : 0;
  const normalizedRemainingMs =
    Number.isFinite(remainingMs) && (remainingMs ?? 0) > 0
      ? Math.min(Math.floor(remainingMs as number), 86_400_000)
      : normalizedTimeRemaining * 1000;
  const normalizedTotalMs =
    Number.isFinite(totalTimeMs) && totalTimeMs > 0
      ? Math.max(1_000, Math.min(Math.floor(totalTimeMs), 86_400_000))
      : 60_000;
  const hasMessage = typeof message === "string" && message.trim().length > 0;
  const isUrgent = !hasMessage && normalizedTimeRemaining > 0 && normalizedTimeRemaining <= 10;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | null>(null);
  const progressRef = useRef<number>(
    Math.max(0, Math.min(1, normalizedRemainingMs / normalizedTotalMs)),
  );
  const targetProgressRef = useRef<number>(
    Math.max(0, Math.min(1, normalizedRemainingMs / normalizedTotalMs)),
  );

  useEffect(() => {
    targetProgressRef.current = Math.max(
      0,
      Math.min(1, normalizedRemainingMs / normalizedTotalMs),
    );
  }, [normalizedRemainingMs, normalizedTotalMs]);

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      progressRef.current =
        progressRef.current +
        (targetProgressRef.current - progressRef.current) * 0.08;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (
        canvas.width !== rect.width * dpr ||
        canvas.height !== rect.height * dpr
      ) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const w = rect.width;
      const h = rect.height;
      const r = 10;
      const lineWidth = 3;
      const perimeter = 2 * (w + h) - 8 * r + 2 * Math.PI * r;
      const drawLength = perimeter * progressRef.current;

      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(w - r, 0);
      ctx.arcTo(w, 0, w, r, r);
      ctx.lineTo(w, h - r);
      ctx.arcTo(w, h, w - r, h, r);
      ctx.lineTo(r, h);
      ctx.arcTo(0, h, 0, h - r, r);
      ctx.lineTo(0, r);
      ctx.arcTo(0, 0, r, 0, r);
      ctx.closePath();

      ctx.strokeStyle = isUrgent
        ? "rgba(239, 68, 68, 0.15)"
        : "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.setLineDash([drawLength, perimeter]);
      ctx.lineDashOffset = 0;
      ctx.strokeStyle = isUrgent
        ? "rgba(239, 68, 68, 0.8)"
        : "rgba(235, 245, 255, 0.9)";
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "round";

      ctx.shadowBlur = 8;
      ctx.shadowColor = isUrgent
        ? "rgba(239, 68, 68, 0.4)"
        : "rgba(255, 255, 255, 0.2)";
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.setLineDash([]);
      requestRef.current = requestAnimationFrame(draw);
    };

    requestRef.current = requestAnimationFrame(draw);
    return () => {
      if (requestRef.current !== null) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [isUrgent]);

  const mins = Math.floor(normalizedTimeRemaining / 60);
  const secs = normalizedTimeRemaining % 60;
  const formatted = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;

  return (
    <div className="relative rounded-[10px] overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
      />
      <div
        className={cn(
          "relative rounded-[10px] p-2 flex flex-col items-center justify-center h-[72px] bg-card/60 transition-all duration-500 gap-0.5",
          isUrgent && "bg-red-950/20",
        )}
      >
        <motion.span
          key={hasMessage ? `msg:${message}` : formatted}
          initial={{ opacity: 0.5, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className={cn(
            "tracking-tight",
            hasMessage ? "text-sm font-semibold text-white/80" : "text-xl font-bold font-mono",
            isUrgent && !hasMessage ? "text-red-400" : !hasMessage ? "text-white/90" : "",
          )}
        >
          {hasMessage ? message : formatted}
        </motion.span>
        {hasMessage ? null : (
          <span
            className={cn(
              "text-[9px] uppercase tracking-wider font-medium",
              isUrgent ? "text-red-400/60" : "text-white/40",
            )}
          >
            Time remaining
          </span>
        )}
      </div>
    </div>
  );
}
