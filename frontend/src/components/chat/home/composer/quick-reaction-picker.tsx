"use client";

/**
 * Compact quick-reaction picker for message reactions.
 * Shows a small row of common emojis — no search, no categories.
 * Inspired by Discord/Telegram quick-react UX.
 */

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🔥", "😮", "😢", "🎉", "💎"];

interface QuickReactionPickerProps {
  onSelect: (emoji: string) => void;
}

export function QuickReactionPicker({ onSelect }: QuickReactionPickerProps) {
  return (
    <div className="flex items-center gap-0.5 p-1.5">
      {QUICK_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(emoji);
          }}
          className="h-8 w-8 grid place-items-center rounded-md text-lg leading-none hover:bg-white/10 hover:scale-110 transition-all active:scale-95"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
