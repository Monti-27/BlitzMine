"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { noteItems } from "../data/note-items";

export function NoteView() {
  return (
    <ScrollArea className="flex-1 px-4 py-4" hideScrollbar>
      <div className="space-y-4">
        <div className="rounded-xl border border-primary/30 bg-primary/10 p-5 shadow-lg shadow-primary/5 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 via-transparent to-transparent opacity-50 group-hover:opacity-100 transition-all duration-500" />
          <div className="flex items-center gap-2.5 mb-3 relative z-10">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary text-primary-foreground uppercase shadow-sm tracking-wide">
              Pinned
            </span>
            <span className="text-xs text-primary/80 font-mono">
              Aug 4, 2026
            </span>
          </div>
          <h4 className="text-lg font-bold text-foreground mb-2 relative z-10">
            Welcome to BlitzMine
          </h4>
          <p className="text-sm text-muted-foreground leading-relaxed relative z-10">
            The local build is ready for Ephemeral Rollup validation. Deploy
            SOL, select tiles, and compete for the shared round pool.
          </p>
        </div>

        {noteItems.map((item) => (
          <div
            key={item.title}
            className="rounded-xl border border-white/5 bg-white/5 p-4 hover:bg-white/10 transition-all cursor-default hover:border-white/10 shadow-sm hover:shadow-md group"
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className={cn(
                  "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase shadow-sm tracking-wide",
                  item.type === "Update"
                    ? "bg-blue-500/20 text-blue-400 border border-blue-500/20"
                    : "bg-purple-500/20 text-purple-400 border border-purple-500/20",
                )}
              >
                {item.type}
              </span>
              <span className="text-xs text-muted-foreground font-mono group-hover:text-foreground transition-colors">
                {item.date}
              </span>
            </div>
            <h4 className="text-sm font-bold text-foreground mb-1 group-hover:text-primary transition-colors">
              {item.title}
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {item.desc}
            </p>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
