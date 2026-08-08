"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface HoverCardContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLSpanElement | null>;
  handleOpen: () => void;
  handleClose: () => void;
}

const HoverCardContext = React.createContext<HoverCardContextType>({
  open: false,
  setOpen: () => {},
  triggerRef: { current: null },
  handleOpen: () => {},
  handleClose: () => {},
});

function HoverCard({
  openDelay = 200,
  closeDelay = 100,
  children,
}: {
  openDelay?: number;
  closeDelay?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const openTimerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleOpen = React.useCallback(() => {
    clearTimeout(closeTimerRef.current);
    openTimerRef.current = setTimeout(() => setOpen(true), openDelay);
  }, [openDelay]);

  const handleClose = React.useCallback(() => {
    clearTimeout(openTimerRef.current);
    closeTimerRef.current = setTimeout(() => setOpen(false), closeDelay);
  }, [closeDelay]);

  React.useEffect(() => {
    return () => {
      clearTimeout(openTimerRef.current);
      clearTimeout(closeTimerRef.current);
    };
  }, []);

  return (
    <HoverCardContext.Provider
      value={{ open, setOpen, triggerRef, handleOpen, handleClose }}
    >
      <span
        ref={triggerRef}
        className="relative inline-flex"
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
      >
        {children}
      </span>
    </HoverCardContext.Provider>
  );
}

function HoverCardTrigger({
  asChild,
  children,
}: {
  asChild?: boolean;
  children: React.ReactNode;
}) {
  if (asChild && React.isValidElement(children)) {
    return children;
  }
  return <span>{children}</span>;
}

function HoverCardContent({
  side = "bottom",
  align = "center",
  sideOffset = 8,
  collisionPadding = 8,
  className,
  children,
}: {
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  collisionPadding?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const { open, triggerRef, handleOpen, handleClose } =
    React.useContext(HoverCardContext);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = React.useState(false);
  const [style, setStyle] = React.useState<React.CSSProperties | null>(null);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = React.useCallback(() => {
    const triggerEl = triggerRef.current;
    const contentEl = contentRef.current;
    if (!triggerEl || !contentEl) return;

    const triggerRect = triggerEl.getBoundingClientRect();
    const contentRect = contentEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const boundaryEl = triggerEl.closest("[data-hover-boundary]") as HTMLElement | null;
    const boundaryRect = boundaryEl?.getBoundingClientRect();
    const bounds = boundaryRect
      ? {
          top: boundaryRect.top + collisionPadding,
          right: boundaryRect.right - collisionPadding,
          bottom: boundaryRect.bottom - collisionPadding,
          left: boundaryRect.left + collisionPadding,
        }
      : {
          top: collisionPadding,
          right: viewportWidth - collisionPadding,
          bottom: viewportHeight - collisionPadding,
          left: collisionPadding,
        };

    const spaceBelow = bounds.bottom - triggerRect.bottom;
    const spaceAbove = triggerRect.top - bounds.top;

    let resolvedSide = side;
    if (side === "bottom") {
      if (
        spaceBelow < contentRect.height + sideOffset + collisionPadding &&
        spaceAbove > spaceBelow
      ) {
        resolvedSide = "top";
      }
    } else if (
      spaceAbove < contentRect.height + sideOffset + collisionPadding &&
      spaceBelow > spaceAbove
    ) {
      resolvedSide = "bottom";
    }

    let left = triggerRect.left;
    if (align === "center") {
      left = triggerRect.left + triggerRect.width / 2 - contentRect.width / 2;
    } else if (align === "end") {
      left = triggerRect.right - contentRect.width;
    }
    const maxLeft = Math.max(bounds.left, bounds.right - contentRect.width);
    left = Math.max(bounds.left, Math.min(left, maxLeft));

    const rawTop =
      resolvedSide === "bottom"
        ? triggerRect.bottom + sideOffset
        : triggerRect.top - contentRect.height - sideOffset;
    const maxTop = Math.max(bounds.top, bounds.bottom - contentRect.height);
    const top = Math.max(bounds.top, Math.min(rawTop, maxTop));

    setStyle({
      position: "fixed",
      top,
      left,
      zIndex: 80,
    });
  }, [align, collisionPadding, side, sideOffset, triggerRef]);

  React.useLayoutEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      updatePosition();
    });
    return () => cancelAnimationFrame(raf);
  }, [open, updatePosition]);

  React.useEffect(() => {
    if (!open) return;
    const listener = () => updatePosition();
    window.addEventListener("resize", listener);
    window.addEventListener("scroll", listener, true);
    return () => {
      window.removeEventListener("resize", listener);
      window.removeEventListener("scroll", listener, true);
    };
  }, [open, updatePosition]);

  if (!mounted) return null;

  const content = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={contentRef}
          onMouseEnter={handleOpen}
          onMouseLeave={handleClose}
          className={cn(
            "z-50 w-64 rounded-md border bg-popover p-4 text-popover-foreground shadow-md",
            className,
          )}
          style={style ?? { position: "fixed", top: -9999, left: -9999, zIndex: 80 }}
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.98 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}

export { HoverCard, HoverCardTrigger, HoverCardContent };
