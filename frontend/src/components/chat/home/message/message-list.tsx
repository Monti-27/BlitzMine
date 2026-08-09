"use client";

import { useCallback, useRef } from "react";
import type {
  HomeChatMessage,
  UserProfileData,
} from "../models/home-chat.types";
import { MessageItem } from "./message-item";

interface MessageListProps {
  messages: HomeChatMessage[];
  getUserProfile?: (walletAddress?: string) => UserProfileData | null;
  currentWallet?: string;
  onRetry?: (clientMessageId: string) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  onReply?: (message: HomeChatMessage) => void;
}

export function MessageList({
  messages,
  getUserProfile,
  currentWallet,
  onRetry,
  onToggleReaction,
  onReply,
}: MessageListProps) {
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setMessageRef = useCallback(
    (id: string) => (element: HTMLDivElement | null) => {
      if (element) {
        messageRefs.current.set(id, element);
      } else {
        messageRefs.current.delete(id);
      }
    },
    [],
  );
  const scrollToMessage = useCallback((messageId: string) => {
    const element = messageRefs.current.get(messageId);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("ring-1", "ring-primary/40", "bg-primary/5");
    setTimeout(() => {
      element.classList.remove("ring-1", "ring-primary/40", "bg-primary/5");
    }, 1500);
  }, []);

  return (
    <div className="space-y-1.5">
      {messages.map((message) => (
        <div
          key={message.id}
          ref={setMessageRef(message.id)}
          className="transition-all duration-500 rounded-xl"
        >
          <MessageItem
            message={message}
            getUserProfile={getUserProfile}
            currentWallet={currentWallet}
            onRetry={onRetry}
            onToggleReaction={onToggleReaction}
            onReply={onReply}
            onScrollToMessage={scrollToMessage}
          />
        </div>
      ))}
    </div>
  );
}
