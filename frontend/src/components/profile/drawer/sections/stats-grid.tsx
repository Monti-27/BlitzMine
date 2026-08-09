"use client";

import type { ProfileDrawerStats } from "../models/profile.types";

interface StatsGridProps {
  stats: ProfileDrawerStats;
}

export function StatsGrid({ stats }: StatsGridProps) {
  return (
    <div className="grid grid-cols-2 gap-3 mb-8">
      {[
        {
          label: "Rank",
          value: stats.rank > 0 ? `#${stats.rank}` : "Unranked",
          className: "col-span-2 bg-white/[0.03] border-white/[0.10]",
        },
        {
          label: "SOL Deployed",
          value: stats.deployedSol.toLocaleString(undefined, {
            maximumFractionDigits: 4,
          }),
          className: "bg-white/[0.02] border-white/[0.08]",
        },
        {
          label: "Rounds Played",
          value: stats.rounds.toLocaleString(),
          className: "bg-white/[0.02] border-white/[0.08]",
        },
      ].map((stat) => (
        <div
          key={stat.label}
          className={`rounded-2xl border p-4 transition-all duration-300 hover:border-white/[0.16] ${stat.className}`}
        >
          <div className="text-[18px] font-mono font-semibold text-white/90 tracking-tight">
            {stat.value}
          </div>
          <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.15em] text-white/35">
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  );
}
