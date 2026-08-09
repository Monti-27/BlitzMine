"use client";

import {
  EmojiPicker as FrimousseEmojiPicker,
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
} from "frimousse";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

function CategoryHeader({ category, ...props }: EmojiPickerListCategoryHeaderProps) {
  return (
    <div
      {...props}
      className={[
        props.className,
        "px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 bg-card/95 backdrop-blur-sm",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {category.label}
    </div>
  );
}

function EmojiRow({ children, ...props }: EmojiPickerListRowProps) {
  return (
    <div
      {...props}
      className={[props.className, "grid grid-cols-9 gap-1 px-2 py-0.5"].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

function EmojiButton({ emoji, ...props }: EmojiPickerListEmojiProps) {
  return (
    <button
      {...props}
      type="button"
      className={[
        props.className,
        "h-8 w-8 grid place-items-center rounded-md text-lg leading-none transition-colors",
        emoji.isActive ? "bg-white/15" : "hover:bg-white/10",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {emoji.emoji}
    </button>
  );
}

export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  return (
    <FrimousseEmojiPicker.Root
      className="w-[320px] bg-card text-foreground"
      columns={9}
      locale="en"
      onEmojiSelect={(emoji) => onSelect(emoji.emoji)}
      sticky
    >
      <div className="flex items-center gap-2 p-2 border-b border-white/10">
        <FrimousseEmojiPicker.Search
          autoFocus
          placeholder="Search emoji..."
          className="h-8 w-full rounded-md border border-white/10 bg-black/30 px-2 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/60"
        />
        <FrimousseEmojiPicker.SkinToneSelector
          className="h-8 w-8 grid place-items-center rounded-md border border-white/10 bg-black/30 text-sm hover:bg-white/10"
          emoji="👋"
        />
      </div>
      <FrimousseEmojiPicker.Viewport className="h-[320px] overflow-y-auto py-2">
        <FrimousseEmojiPicker.Loading>
          <div className="h-[320px] grid place-items-center text-xs text-muted-foreground">
            Loading emojis...
          </div>
        </FrimousseEmojiPicker.Loading>
        <FrimousseEmojiPicker.Empty>
          {({ search }) => (
            <div className="h-[120px] grid place-items-center px-4 text-center text-xs text-muted-foreground">
              {search ? `No emoji found for "${search}"` : "No emoji found"}
            </div>
          )}
        </FrimousseEmojiPicker.Empty>
        <FrimousseEmojiPicker.List
          components={{
            CategoryHeader,
            Row: EmojiRow,
            Emoji: EmojiButton,
          }}
        />
      </FrimousseEmojiPicker.Viewport>
    </FrimousseEmojiPicker.Root>
  );
}
