"use client";

interface UseControlPanelControllerParams {
  deployAmount: number;
  selectedBlocks: number[];
  onDeployAmountChange: (amount: number) => void;
}

export function useControlPanelController({
  deployAmount,
  selectedBlocks,
  onDeployAmountChange,
}: UseControlPanelControllerParams) {
  const totalCost = deployAmount * selectedBlocks.length;

  const handleQuickAdd = (amount: number) => {
    onDeployAmountChange(Math.max(0, deployAmount + amount));
  };

  return {
    totalCost,
    handleQuickAdd,
  };
}
