"use client";

import type React from "react";
import { Avatar } from "@/components/ui/wallet-avatar";

interface AvatarEditorProps {
  userName: string;
  walletAddress: string;
  userPfp: string;
  editing: boolean;
  tempName: string;
  setTempName: (value: string) => void;
  setEditing: (value: boolean) => void;
  setUserPfp: (value: string) => void;
  onSave: () => void;
}

export function AvatarEditor({
  userName,
  walletAddress,
  userPfp,
  editing,
  tempName,
  setTempName,
  setEditing,
  setUserPfp,
  onSave,
}: AvatarEditorProps) {
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setUserPfp(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col items-center pb-7 pt-2">
      <div className="mb-6 text-center">
        <p className="text-[10px] uppercase tracking-[0.16em] text-white/40">Account</p>
      </div>

      <div className="group relative">
        <div className="absolute inset-0 -m-1 rounded-full bg-gradient-to-b from-white/15 to-transparent blur-md opacity-60" />
        <Avatar
          walletAddress={walletAddress || userName}
          avatarUrl={userPfp}
          alt={userName}
          size={92}
          className="relative border-2 border-white/[0.14] transition-all duration-300 group-hover:border-white/[0.28]"
        />
        <label
          htmlFor="drawer-pfp"
          className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/[0.18] bg-black/50 transition-all duration-200 hover:bg-white/[0.09]"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-white/60"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </label>
        <input
          id="drawer-pfp"
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="hidden"
        />
      </div>

      <div className="mt-6 flex items-center gap-2">
        {editing ? (
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2">
            <input
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSave()}
              className="w-36 border-b border-white/20 bg-transparent pb-0.5 text-center text-lg font-semibold text-white outline-none transition-colors focus:border-white/50"
            />
            <button
              type="button"
              onClick={onSave}
              className="text-[10px] font-bold uppercase tracking-widest text-white/50 transition-colors hover:text-white"
            >
              done
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setTempName(userName);
              setEditing(true);
            }}
            className="group flex items-center gap-2"
          >
            <span className="text-xl font-semibold text-white">
              {userName}
            </span>
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-white/25 transition-colors duration-200 group-hover:text-white/55"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
