"use client";

interface ChatHistorySkeletonProps {
  rows?: number;
}

export function ChatHistorySkeleton({ rows = 8 }: ChatHistorySkeletonProps) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={`chat-skeleton-${index}`}
          className="flex items-start gap-3 rounded-xl px-3 py-2.5"
        >
          <div className="skeleton h-9 w-9 shrink-0 rounded-lg" />

          <div className="flex-1 pt-0.5">
            <div className="mb-2 flex items-center justify-between">
              <div className="skeleton h-3 w-24 rounded" />
              <div className="skeleton h-2.5 w-10 rounded" />
            </div>
            <div className="space-y-1.5">
              <div className="skeleton h-3.5 w-[92%] rounded" />
              <div className="skeleton h-3.5 w-[74%] rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
