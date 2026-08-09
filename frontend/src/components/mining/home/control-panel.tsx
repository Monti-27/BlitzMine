"use client";

import { Coins, Wallet } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { formatSol, formatUsd } from "@/lib/format";
import { CONTROL_PANEL_DEFAULTS } from "./data/control-panel.defaults";
import { useControlPanelController } from "./hooks/use-control-panel-controller";
import type { ControlPanelProps } from "./models/control-panel.types";
import { DeployFooter } from "./sections/deploy-footer";
import { ManualMode } from "./sections/manual-mode";
import { WinnerView } from "./sections/winner-view";
import { AnimatedStatCard } from "./widgets/animated-stat-card";
import { TimerCard } from "./widgets/timer-card";

export function ControlPanel({
  selectedBlocks,
  lockedBlocks,
  deployAmount,
  onDeployAmountChange,
  onSelectAll,
  onClearSelection,
  onDeploy,
  onCashOut,
  timeRemaining,
  timerRemainingMs,
  timerTotalMs,
  timerMessage,
  totalDeployed,
  youDeployedSol,
  walletBalanceSol,
  walletBalanceLoading,
  cashOutAvailableSol,
  cashOutAvailableLoading,
  cashOutAvailableError,
  cashOutSettlementState,
  cashOutSettlementKind,
  cashOutSettlementRoundId,
  cashOutPendingWinningsSol,
  cashOutErrorMessage,
  onRetryCashOutAvailable,
  solPriceUsd,
  solPriceLoading,
  minersCount,
  motherlode,
  roundPhase,
  isAwaitingRoundEnd,
  isShowingWinner,
  winnerCountdown,
  roundResult,
  resolutionRpcUrl,
  isDeployPending = false,
  isCashOutPending = false,
  isDeployBlockedByRuntime = false,
}: ControlPanelProps) {
  const { totalCost, handleQuickAdd } = useControlPanelController({
    deployAmount,
    selectedBlocks,
    onDeployAmountChange,
  });
  const [deployAmountInput, setDeployAmountInput] = useState("");
  const [isAmountInputFocused, setIsAmountInputFocused] = useState(false);

  useEffect(() => {
    if (isAmountInputFocused) return;
    if (deployAmount <= 0) {
      setDeployAmountInput("");
      return;
    }
    setDeployAmountInput(formatSol(deployAmount, 9, 0));
  }, [deployAmount, isAmountInputFocused]);

  const motherlodeUsd = solPriceUsd === null ? null : motherlode * solPriceUsd;
  const totalDeployedUsd =
    solPriceUsd === null ? null : totalDeployed * solPriceUsd;
  const youDeployedUsd =
    solPriceUsd === null ? null : youDeployedSol * solPriceUsd;
  const isCashOutBalanceUnavailable =
    cashOutAvailableError && cashOutAvailableSol === null;
  const isPendingSettlement = cashOutSettlementState === "pending";
  const isCurrentRoundLocked = cashOutSettlementState === "round-active";
  const hasSettledBalance = (cashOutAvailableSol ?? 0) > 0;
  const hasPendingPayout =
    isPendingSettlement &&
    (cashOutSettlementKind === "winnings" ||
      cashOutSettlementKind === "refund" ||
      cashOutSettlementKind === "unknown" ||
      hasSettledBalance);
  const canCashOut = isPendingSettlement
    ? hasPendingPayout
    : cashOutSettlementState === "settled" && hasSettledBalance;
  const cashOutHeading = isPendingSettlement
    ? cashOutSettlementKind === "winnings"
      ? "Winnings pending"
      : cashOutSettlementKind === "refund"
        ? "Refund pending"
        : cashOutSettlementKind === "none"
          ? "Round settled"
          : "Settlement pending"
    : isCurrentRoundLocked
      ? "Available after round"
      : "Available to cash out";
  const settlementRoundLabel =
    cashOutSettlementRoundId === null
      ? "Last round"
      : `Round #${cashOutSettlementRoundId}`;
  const cashOutHelper = isPendingSettlement
    ? cashOutSettlementKind === "none"
      ? hasSettledBalance
        ? `${settlementRoundLabel} has no new payout`
        : `${settlementRoundLabel} ended without a payout`
      : `${settlementRoundLabel} must settle before claiming`
    : isCurrentRoundLocked
      ? "Current deployment must finish first"
      : null;

  const handleDeployAmountInputChange = (raw: string) => {
    if (!/^\d*\.?\d*$/.test(raw)) return;
    setDeployAmountInput(raw);

    if (raw === "" || raw === ".") {
      onDeployAmountChange(0);
      return;
    }

    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      onDeployAmountChange(parsed);
    }
  };

  const handleDeployAmountInputBlur = () => {
    setIsAmountInputFocused(false);
    const raw = deployAmountInput.trim();
    if (raw === "" || raw === ".") {
      setDeployAmountInput("");
      onDeployAmountChange(0);
      return;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDeployAmountInput(
        deployAmount > 0 ? formatSol(deployAmount, 9, 0) : "",
      );
      return;
    }

    const normalized = formatSol(parsed, 9, 0);
    setDeployAmountInput(normalized === "0" ? "" : normalized);
    onDeployAmountChange(parsed);
  };

  if (roundPhase === "WINNER_FOCUS" && isShowingWinner && roundResult) {
    return (
      <WinnerView
        roundResult={roundResult}
        winnerCountdown={winnerCountdown}
        resolutionRpcUrl={resolutionRpcUrl}
      />
    );
  }

  return (
    <div className="w-full max-w-[480px] flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <AnimatedStatCard
          label="Motherlode"
          value={formatSol(motherlode, 1, 1)}
          subValue={
            motherlodeUsd === null ? undefined : formatUsd(motherlodeUsd)
          }
          icon={
            <Image
              src="/solana-logo.svg"
              alt="SOL"
              width={20}
              height={20}
              className="h-5 w-5"
            />
          }
          hoverToUsd
        />

        <TimerCard
          timeRemaining={timeRemaining}
          remainingMs={timerRemainingMs}
          totalTimeMs={timerTotalMs}
          message={timerMessage}
        />

        <AnimatedStatCard
          label="Total Deployed"
          value={formatSol(totalDeployed, 9, 0)}
          subValue={
            totalDeployedUsd === null ? undefined : formatUsd(totalDeployedUsd)
          }
          isLoading={solPriceLoading && totalDeployedUsd === null}
          hoverToUsd
          icon={
            <Image
              src="/solana-logo.svg"
              alt="SOL"
              width={16}
              height={16}
              className="h-4 w-4"
            />
          }
        />

        <AnimatedStatCard
          label="You Deployed"
          value={formatSol(youDeployedSol, 9, 0)}
          subValue={
            youDeployedUsd === null ? undefined : formatUsd(youDeployedUsd)
          }
          isLoading={solPriceLoading && youDeployedUsd === null}
          hoverToUsd
          icon={
            <Image
              src="/solana-logo.svg"
              alt="SOL"
              width={16}
              height={16}
              className="h-4 w-4"
            />
          }
        />
      </div>

      <div className="rounded-xl bg-card/80 overflow-hidden">
        {roundPhase === "DISSOLVING" && isAwaitingRoundEnd && (
          <div className="px-3 pt-2 pb-1 text-[11px] text-muted-foreground/80">
            Finalizing on-chain...
          </div>
        )}
        <div className="flex items-center justify-between p-3">
          <span className="text-xs font-semibold text-foreground">
            Live deployment
          </span>
          <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-mono text-primary">
            EPHEMERAL ROLLUP
          </span>
        </div>

        <div className="h-px bg-border/50" />

        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Wallet balance
            </div>
            <div className="mt-1 flex items-center gap-2 text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
              {walletBalanceLoading && walletBalanceSol === null ? (
                <span className="skeleton h-4 w-24 rounded" />
              ) : (
                <span className="text-xs font-mono">
                  {walletBalanceSol === null
                    ? "—"
                    : `${formatSol(walletBalanceSol, 9, 0)} SOL`}
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-1.5">
            {CONTROL_PANEL_DEFAULTS.quickAddAmounts.map((amt) => (
              <button
                type="button"
                key={amt}
                onClick={() => handleQuickAdd(amt)}
                aria-label={`Add ${amt} SOL`}
                className="min-h-10 rounded-md bg-muted/50 px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                +{amt}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/50 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
              {cashOutHeading}
            </div>
            <div
              className="mt-1 flex items-center gap-2 text-foreground"
              aria-live="polite"
            >
              <Coins className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              {isCashOutBalanceUnavailable ? (
                <span className="text-xs text-muted-foreground">
                  Balance unavailable
                </span>
              ) : cashOutAvailableLoading && cashOutAvailableSol === null ? (
                <span className="skeleton h-4 w-24 rounded" />
              ) : (
                <span className="text-xs font-semibold font-mono">
                  {isPendingSettlement &&
                  cashOutSettlementKind === "winnings" &&
                  cashOutPendingWinningsSol !== null
                    ? `+${formatSol(cashOutPendingWinningsSol, 9, 0)} SOL prize`
                    : isPendingSettlement && cashOutSettlementKind === "refund"
                      ? `${settlementRoundLabel} stake`
                      : isPendingSettlement &&
                          cashOutSettlementKind === "unknown"
                        ? settlementRoundLabel
                        : isPendingSettlement &&
                            cashOutSettlementKind === "none" &&
                            !hasSettledBalance
                          ? "No payout"
                          : cashOutAvailableSol === null
                            ? "—"
                            : `${formatSol(cashOutAvailableSol, 9, 0)} SOL`}
                </span>
              )}
            </div>
            {cashOutHelper && (
              <div className="mt-1 text-[10px] text-muted-foreground">
                {cashOutHelper}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={
              isCashOutBalanceUnavailable ? onRetryCashOutAvailable : onCashOut
            }
            aria-busy={isCashOutPending}
            disabled={
              !isCashOutBalanceUnavailable &&
              (isCashOutPending ||
                isDeployPending ||
                cashOutAvailableLoading ||
                cashOutAvailableSol === null ||
                !canCashOut)
            }
            className="min-h-10 rounded-md border border-primary/30 bg-primary/10 px-3 text-xs font-semibold text-primary transition-colors hover:border-primary/50 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:border-border/60 disabled:bg-transparent disabled:text-muted-foreground disabled:opacity-50"
          >
            {isCashOutBalanceUnavailable
              ? "Retry"
              : isCashOutPending
                ? isPendingSettlement
                  ? "Settling…"
                  : "Cashing out…"
                : isPendingSettlement
                  ? hasPendingPayout
                    ? "Settle & cash out"
                    : "No payout"
                  : isCurrentRoundLocked
                    ? "Round active"
                    : "Cash out"}
          </button>
        </div>
        {cashOutErrorMessage && (
          <p
            role="alert"
            className="border-t border-border/50 px-3 py-2 text-xs text-destructive"
          >
            {cashOutErrorMessage}
          </p>
        )}

        <div className="flex flex-col gap-1 px-3 pb-3 pt-1">
          <div className="flex items-center justify-between min-h-[36px]">
            <div className="flex items-center gap-2 min-w-[100px]">
              <Image
                src="/solana-logo.svg"
                alt="SOL"
                width={20}
                height={20}
                className="h-5 w-5 flex-shrink-0"
              />
              <span className="text-sm font-semibold text-foreground">SOL</span>
            </div>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={deployAmountInput}
              aria-label="SOL per tile"
              onFocus={() => setIsAmountInputFocused(true)}
              onBlur={handleDeployAmountInputBlur}
              onChange={(e) => handleDeployAmountInputChange(e.target.value)}
              className="text-xl font-bold font-mono text-right bg-transparent w-full focus:outline-none text-primary"
            />
          </div>
        </div>
        <ManualMode
          selectedBlocks={selectedBlocks}
          totalCost={totalCost}
          onSelectAll={onSelectAll}
          onClearSelection={onClearSelection}
        />
      </div>

      <DeployFooter
        lockedBlocks={lockedBlocks}
        selectedBlocks={selectedBlocks}
        minersCount={minersCount}
        isPending={isDeployPending}
        isDeployBlockedByRuntime={isDeployBlockedByRuntime}
        onDeploy={onDeploy}
      />
    </div>
  );
}
