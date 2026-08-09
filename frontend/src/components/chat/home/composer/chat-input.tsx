"use client";

import { useCallback, useRef, useState } from "react";
import { Send, Smile, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmojiPicker } from "./emoji-picker";
import type { ReplyContext } from "../models/home-chat.types";

function shortWallet(wallet: string): string {
  if (wallet.length <= 10) return wallet;
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onSubmit: () => void;
  disabled?: boolean;
  disabledActionLabel?: string;
  onDisabledAction?: () => void;
  replyContext?: ReplyContext | null;
  onClearReply?: () => void;
}

export function ChatInput({
  value,
  onChange,
  placeholder,
  onSubmit,
  disabled = false,
  disabledActionLabel,
  onDisabledAction,
  replyContext,
  onClearReply,
}: ChatInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const insertEmoji = useCallback(
    (emoji: string) => {
      const input = inputRef.current;
      if (!input) {
        onChange(`${value}${emoji}`);
        setEmojiOpen(false);
        return;
      }

      const start = input.selectionStart ?? value.length;
      const end = input.selectionEnd ?? value.length;
      const next = `${value.slice(0, start)}${emoji}${value.slice(end)}`;
      onChange(next);
      setEmojiOpen(false);

      const cursor = start + emoji.length;
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(cursor, cursor);
      });
    },
    [onChange, value],
  );

  return (
    <div className="bg-black/20 border-t border-white/5 backdrop-blur-sm">
      {/* Reply context bar */}
      {replyContext && (
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <div className="w-0.5 self-stretch bg-primary/50 rounded-full shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-[10px] font-semibold text-primary/70 block truncate">
              Replying to {replyContext.username?.trim() || shortWallet(replyContext.sender)}
            </span>
            <span className="text-[11px] text-muted-foreground/50 block truncate">
              {replyContext.contentPreview}
            </span>
          </div>
          <button
            type="button"
            onClick={onClearReply}
            className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="p-4 pt-2">
        <div className="flex items-center gap-2 bg-white/5 rounded-xl px-4 py-3 border border-white/5 transition-all shadow-inner group">
          <input
            ref={inputRef}
            type="text"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
          {disabled && disabledActionLabel && onDisabledAction && (
            <button
              type="button"
              onClick={onDisabledAction}
              className="h-7 px-2.5 rounded-md border border-white/15 bg-white/5 text-[11px] font-medium text-foreground/85 hover:text-foreground hover:border-white/25 transition-colors"
            >
              {disabledActionLabel}
            </button>
          )}
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger
              type="button"
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors disabled:opacity-40"
              disabled={disabled}
            >
              <Smile className="w-4 h-4" />
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="top"
              className="p-0 border border-white/10 bg-card/95 backdrop-blur-md rounded-lg overflow-hidden"
            >
              <EmojiPicker onSelect={insertEmoji} />
            </PopoverContent>
          </Popover>
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled}
            className="p-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-all shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 group-focus-within:shadow-primary/40"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
