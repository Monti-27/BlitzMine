"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Reply, Smile } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/wallet-avatar";
import { cn } from "@/lib/utils";
import { UserProfileHoverCard } from "../hover/user-profile-hover-card";
import type {
  HomeChatMessage,
  UserProfileData,
} from "../models/home-chat.types";

interface MessageItemProps {
  message: HomeChatMessage;
  getUserProfile?: (walletAddress?: string) => UserProfileData | null;
  currentWallet?: string;
  onRetry?: (clientMessageId: string) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  onReply?: (message: HomeChatMessage) => void;
  onScrollToMessage?: (messageId: string) => void;
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "👀", "🎉"];

function shortWallet(wallet: string): string {
  if (wallet.length <= 10) return wallet;
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

function formatTimestampDate(isoLike?: string): string | null {
  if (!isoLike) return null;
  const date = new Date(isoLike);
  if (Number.isNaN(date.getTime())) return null;
  const day = String(date.getDate()).padStart(2, "0");
  const month = date.toLocaleString("en-US", { month: "short" });
  const year = String(date.getFullYear()).slice(-2);
  return `${day} ${month} ${year}`;
}

function MessageTimestamp({
  timeLabel,
  createdAt,
}: {
  timeLabel: string;
  createdAt?: string;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const dateLabel = useMemo(() => formatTimestampDate(createdAt), [createdAt]);
  const showDate = isHovered && Boolean(dateLabel);

  return (
    <button
      type="button"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="relative h-3 min-w-[60px] text-right text-[10px] text-muted-foreground/40 focus:outline-none"
      aria-label={dateLabel ? `Sent at ${dateLabel}` : `Sent at ${timeLabel}`}
    >
      <AnimatePresence mode="wait">
        <motion.span
          key={showDate ? "date" : "time"}
          initial={{ opacity: 0, filter: "blur(4px)", scale: 0.95 }}
          animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
          exit={{ opacity: 0, filter: "blur(4px)", scale: 0.95 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="absolute inset-0 whitespace-nowrap"
        >
          {showDate ? dateLabel : timeLabel}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function ReactionPills({
  reactions,
  messageId,
  currentWallet,
  onToggle,
}: {
  reactions: HomeChatMessage["reactions"];
  messageId: string;
  currentWallet?: string;
  onToggle?: (messageId: string, emoji: string) => void;
}) {
  if (!reactions || reactions.length === 0) return null;
  const visible = reactions.slice(0, 6);
  const overflow = Math.max(0, reactions.length - visible.length);

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {visible.map((reaction) => {
        const isSelf = currentWallet
          ? reaction.reactors.includes(currentWallet)
          : false;
        return (
          <button
            key={reaction.emoji}
            type="button"
            onClick={() => onToggle?.(messageId, reaction.emoji)}
            title={reaction.reactors.map(shortWallet).join(", ")}
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs transition-colors",
              "bg-white/5 hover:bg-white/10 border",
              isSelf
                ? "border-primary/50 text-primary"
                : "border-white/5 text-muted-foreground",
            )}
          >
            <span className="text-sm leading-none">{reaction.emoji}</span>
            <span className="text-[10px] font-medium">{reaction.count}</span>
          </button>
        );
      })}
      {overflow > 0 && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] text-muted-foreground/60 bg-white/5 border border-white/5">
          +{overflow}
        </span>
      )}
    </div>
  );
}

function ReplyPreview({
  replyTo,
  onScrollToMessage,
}: {
  replyTo: HomeChatMessage["replyTo"];
  onScrollToMessage?: (messageId: string) => void;
}) {
  if (!replyTo) return null;
  return (
    <button
      type="button"
      onClick={() => onScrollToMessage?.(replyTo.id)}
      className="flex items-start gap-2 mb-1 w-full text-left group/reply"
    >
      <div className="w-0.5 self-stretch bg-primary/40 rounded-full shrink-0" />
      <div className="min-w-0 overflow-hidden">
        <span className="text-[10px] font-semibold text-primary/70 block truncate">
          {replyTo.username?.trim() || shortWallet(replyTo.sender)}
        </span>
        <span className="text-[11px] text-muted-foreground/50 block truncate group-hover/reply:text-muted-foreground/70 transition-colors">
          {replyTo.contentPreview || "Original message unavailable"}
        </span>
      </div>
    </button>
  );
}

function HoverActions({
  message,
  onReply,
  onToggleReaction,
}: {
  message: HomeChatMessage;
  onReply?: (message: HomeChatMessage) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
}) {
  const [showQuickReactions, setShowQuickReactions] = useState(false);
  return (
    <div className="absolute -top-3 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
      <div className="flex items-center gap-0.5 bg-card/95 border border-white/10 rounded-md shadow-lg backdrop-blur-sm px-0.5 py-0.5">
        {showQuickReactions && (
          <div className="flex items-center gap-0.5 pr-0.5 border-r border-white/10 mr-0.5">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleReaction?.(message.id, emoji);
                  setShowQuickReactions(false);
                }}
                className="w-7 h-7 grid place-items-center rounded hover:bg-white/10 text-sm transition-colors hover:scale-110"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setShowQuickReactions((visible) => !visible);
          }}
          className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          title="React"
        >
          <Smile className="w-3.5 h-3.5" />
        </button>
        {onReply && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onReply(message);
            }}
            className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
            title="Reply"
          >
            <Reply className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function MessageItem({
  message,
  getUserProfile,
  currentWallet,
  onRetry,
  onToggleReaction,
  onReply,
  onScrollToMessage,
}: MessageItemProps) {
  const walletAddress = message.walletAddress ?? "unknown-wallet";
  const resolvedProfile = getUserProfile?.(walletAddress) ?? null;
  const displayName =
    resolvedProfile?.username?.trim() || shortWallet(walletAddress);
  const hoverProfile: UserProfileData = resolvedProfile ?? {
    username: displayName,
    walletAddress,
    avatarColor: "bg-muted",
    loading: true,
    unavailable: true,
  };

  return (
    <div className="group relative flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors">
      <HoverActions
        message={message}
        onReply={onReply}
        onToggleReaction={onToggleReaction}
      />
      <div className="relative pt-0.5">
        <UserProfileHoverCard user={hoverProfile}>
          <div className="cursor-pointer hover:ring-2 hover:ring-primary/50 rounded-lg transition-all">
            <Avatar
              walletAddress={walletAddress}
              avatarUrl={resolvedProfile?.avatarImage}
              alt={displayName}
              size={36}
            />
          </div>
        </UserProfileHoverCard>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-sm font-bold text-foreground hover:text-primary transition-colors cursor-pointer">
            {displayName}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {message.deliveryStatus === "pending" && (
              <span className="text-[10px] text-muted-foreground/60">
                sending...
              </span>
            )}
            {message.deliveryStatus === "failed" &&
              message.clientMessageId &&
              onRetry && (
                <button
                  type="button"
                  onClick={() => onRetry(message.clientMessageId as string)}
                  className="text-[10px] text-destructive hover:text-destructive/80 transition-colors"
                >
                  retry
                </button>
              )}
            <MessageTimestamp
              timeLabel={message.timestamp}
              createdAt={message.createdAt}
            />
          </div>
        </div>
        <ReplyPreview
          replyTo={message.replyTo}
          onScrollToMessage={onScrollToMessage}
        />
        <p className="text-[15px] text-muted-foreground break-words leading-relaxed selection:bg-primary/30 selection:text-foreground">
          {message.message}
        </p>
        <ReactionPills
          reactions={message.reactions}
          messageId={message.id}
          currentWallet={currentWallet}
          onToggle={onToggleReaction}
        />
      </div>
    </div>
  );
}
