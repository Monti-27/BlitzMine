"use client";

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatInput } from "../composer/chat-input";
import { ChatHistorySkeleton } from "../loading/chat-history-skeleton";
import { MessageList } from "../message/message-list";
import type {
  HomeChatMessage,
  ReplyContext,
  UserProfileData,
} from "../models/home-chat.types";

interface GlobalChatViewProps {
  messages: HomeChatMessage[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  inputDisabled?: boolean;
  disabledPlaceholder?: string;
  disabledActionLabel?: string;
  onDisabledAction?: () => void;
  isLoadingHistory?: boolean;
  getUserProfile: (walletAddress?: string) => UserProfileData | null;
  onRetryMessage?: (clientMessageId: string) => void;
  currentWallet?: string;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  replyContext?: ReplyContext | null;
  onReply?: (message: HomeChatMessage) => void;
  onClearReply?: () => void;
}

export function GlobalChatView({
  messages,
  inputValue,
  onInputChange,
  onSubmit,
  inputDisabled = false,
  disabledPlaceholder,
  disabledActionLabel,
  onDisabledAction,
  isLoadingHistory = false,
  getUserProfile,
  onRetryMessage,
  currentWallet,
  onToggleReaction,
  replyContext,
  onReply,
  onClearReply,
}: GlobalChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousCountRef = useRef(0);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (messages.length === 0) {
      previousCountRef.current = 0;
      return;
    }

    const isFirstPaint = previousCountRef.current === 0;
    previousCountRef.current = messages.length;

    requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: isFirstPaint ? "auto" : "smooth",
      });
    });
  }, [messages]);

  return (
    <>
      <ScrollArea ref={scrollRef} className="flex-1 px-3 py-3" hideScrollbar>
        {isLoadingHistory && messages.length === 0 ? (
          <div className="min-h-[220px]">
            <ChatHistorySkeleton rows={9} />
          </div>
        ) : (
          <MessageList
            messages={messages}
            getUserProfile={getUserProfile}
            currentWallet={currentWallet}
            onRetry={onRetryMessage}
            onToggleReaction={onToggleReaction}
            onReply={onReply}
          />
        )}
      </ScrollArea>
      <ChatInput
        value={inputValue}
        onChange={onInputChange}
        placeholder={
          inputDisabled
            ? (disabledPlaceholder ?? "Connect wallet to chat")
            : "Type a message..."
        }
        disabledActionLabel={disabledActionLabel}
        onDisabledAction={onDisabledAction}
        onSubmit={onSubmit}
        disabled={inputDisabled}
        replyContext={replyContext}
        onClearReply={onClearReply}
      />
    </>
  );
}
