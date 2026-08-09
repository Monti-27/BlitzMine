"use client";

import { MessageSquare, StickyNote, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HomeChatTab } from "../models/home-chat.types";

interface ChatTabsProps {
  activeTab: HomeChatTab;
  setActiveTab: (tab: HomeChatTab) => void;
  onClose: () => void;
}

export function ChatTabs({ activeTab, setActiveTab, onClose }: ChatTabsProps) {
  return (
    <div className="flex items-center justify-between px-4 py-4 bg-white/[0.03] border-b border-white/5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("chat")}
          className={cn(
            "flex min-h-10 items-center gap-2 rounded-lg px-3 pl-2.5 text-xs font-bold uppercase tracking-wider transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            activeTab === "chat"
              ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
              : "text-muted-foreground hover:text-foreground hover:bg-white/5",
          )}
        >
          <MessageSquare className="w-4 h-4" aria-hidden="true" />
          Global
        </button>
        <div className="h-5 w-[1px] bg-white/10 mx-1" />
        <button
          type="button"
          onClick={() => setActiveTab("news")}
          className={cn(
            "flex min-h-10 items-center gap-2 rounded-lg px-3 pl-2.5 text-xs font-bold uppercase tracking-wider transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            activeTab === "news"
              ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
              : "text-muted-foreground hover:text-foreground hover:bg-white/5",
          )}
        >
          <StickyNote className="w-4 h-4" aria-hidden="true" />
          Note
        </button>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close chat"
        className="group flex h-10 w-10 items-center justify-center rounded-full transition-all hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-90"
      >
        <X
          className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors"
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
