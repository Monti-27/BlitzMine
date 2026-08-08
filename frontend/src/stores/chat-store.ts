"use client";

import { create } from "zustand";

interface ChatState {
  isOpen: boolean;
  connected: boolean;
  toggleChat: () => void;
  setConnected: (v: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  isOpen: false,
  connected: false,
  toggleChat: () => set((s) => ({ isOpen: !s.isOpen })),
  setConnected: (connected) => set({ connected }),
}));
