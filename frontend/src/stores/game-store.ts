"use client";

import { create } from "zustand";
import type { RoundAccount } from "@/lib/types";

interface GameState {
  round: RoundAccount | null;
  selectedSquares: number[];
  winningSquare: number | null;
  board: { roundId: number; startSlot: number; endSlot: number | null } | null;
  deployModalOpen: boolean;
  setRound: (round: RoundAccount) => void;
  toggleSquare: (index: number) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setWinningSquare: (index: number | null) => void;
  setBoard: (
    board: {
      roundId: number;
      startSlot: number;
      endSlot: number | null;
    } | null,
  ) => void;
  openDeployModal: () => void;
  closeDeployModal: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  round: null,
  selectedSquares: [],
  winningSquare: null,
  board: null,
  deployModalOpen: false,
  setRound: (round) => set({ round }),
  toggleSquare: (index) =>
    set((s) => ({
      selectedSquares: s.selectedSquares.includes(index)
        ? s.selectedSquares.filter((i) => i !== index)
        : [...s.selectedSquares, index],
    })),
  selectAll: () =>
    set({ selectedSquares: Array.from({ length: 25 }, (_, i) => i) }),
  clearSelection: () => set({ selectedSquares: [] }),
  setWinningSquare: (index) => set({ winningSquare: index }),
  setBoard: (board) => set({ board }),
  openDeployModal: () => set({ deployModalOpen: true }),
  closeDeployModal: () => set({ deployModalOpen: false }),
}));
