"use client";

import { Avatar } from "@/components/ui/wallet-avatar";

interface ProfileTriggerProps {
  userName: string;
  walletAddress?: string;
  userPfp: string;
  onOpen: () => void;
}

export function ProfileTrigger({
  userName,
  walletAddress,
  userPfp,
  onOpen,
}: ProfileTriggerProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="focus:outline-none rounded-xl ring-offset-[#080808] focus:ring-1 focus:ring-white/20"
    >
      <Avatar
        walletAddress={walletAddress ?? userName}
        avatarUrl={userPfp}
        alt={userName}
        size={40}
        className="cursor-pointer border border-white/10 transition-all hover:border-white/30"
      />
    </button>
  );
}
