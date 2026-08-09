"use client";

import Link from "next/link";

interface DrawerActionsProps {
  onClose: () => void;
  onDisconnect: () => void | Promise<void>;
}

export function DrawerActions({ onClose, onDisconnect }: DrawerActionsProps) {
  return (
    <div className="space-y-2">
      <Link
        href="/profile"
        onClick={onClose}
        className="flex items-center gap-3 rounded-2xl border border-white/[0.10] bg-white/[0.03] px-4 py-3.5 text-white/80 transition-all duration-200 hover:border-white/[0.20] hover:bg-white/[0.05]"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="opacity-70"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        <span className="text-[13px] font-medium">View Full Profile</span>
      </Link>

      <button
        type="button"
        onClick={() => {
          void onDisconnect();
        }}
        className="w-full flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-transparent px-4 py-3.5 text-white/45 transition-all duration-200 hover:border-red-400/40 hover:text-red-300 hover:bg-red-500/[0.05]"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="opacity-60"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        <span className="text-[13px] font-medium">Disconnect</span>
      </button>
    </div>
  );
}
