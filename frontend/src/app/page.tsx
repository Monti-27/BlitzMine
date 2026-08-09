"use client";

import { useState } from "react";
import { ChatPanel } from "@/components/chat/home/chat-panel";
import { RoundHistory } from "@/components/history/home-round-history/round-history";
import { AppHeader } from "@/components/layout/app-header/app-header";
import { MiningGrid } from "@/components/mining/home/board/mining-grid";
import { ControlPanel } from "@/components/mining/home/control-panel";
import { useMiningRuntime } from "@/hooks/use-mining-runtime";

export default function Page() {
  const [isChatOpen, setIsChatOpen] = useState(true);

  const {
    roundNumber,
    blocks,
    minersCount,
    totalDeployed,
    timeRemaining,
    timerRemainingMs,
    timerTotalMs,
    timerMessage,
    motherlode,
    roundPhase,
    isAwaitingRoundEnd,
    dissolveProgressByBlock,
    resolutionWinningBlock,
    isCinematicLocked,
    isWinnerRevealed,
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
    retryCashOutAvailable,
    solPriceUsd,
    solPriceLoading,
    isShowingWinner,
    winnerCountdown,
    roundResult,
    resolutionRpcUrl,
    roundHistory,
    selectedBlocks,
    lockedBlocks,
    pendingBlocks,
    deployAmount,
    setDeployAmount,
    handleBlockSelect,
    handleDeploy,
    handleCashOut,
    handleSelectAll,
    handleClearSelection,
    isDeployPending,
    isCashOutPending,
    isDeployBlockedByRuntime,
  } = useMiningRuntime();

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden selection:bg-primary/20 text-foreground">
      <AppHeader />

      <main className="flex-1 flex overflow-hidden min-h-0 relative">
        {/* Background Ambient Glow */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.015)_0%,transparent_100%)] pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1200px] h-[500px] bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.02)_0%,transparent_100%)] pointer-events-none" />

        <ChatPanel isOpen={isChatOpen} onToggle={setIsChatOpen} />

        {/* Center/Right Content: Grid & Controls - Tightly Packed */}
        <section
          className={`flex-1 flex items-start justify-center overflow-y-auto overflow-x-hidden scrollbar-hide py-4 lg:py-8 px-4 bg-background relative z-10 box-border lg:transition-[padding-left] lg:duration-300 lg:ease-out ${
            isChatOpen ? "lg:pl-[448px]" : "lg:pl-0"
          }`}
        >
          <div
            className={`flex flex-col gap-6 lg:gap-8 w-full max-w-fit justify-center items-center lg:items-start min-h-min mx-auto ${
              isChatOpen ? "xl:flex-row" : "lg:flex-row"
            }`}
          >
            {/* Left Column: Mining Grid + History */}
            <div className="flex flex-col gap-4 items-center w-full lg:w-auto min-w-0">
              {/* Grid Container - adaptive size based on height */}
              <div
                className={`relative w-full max-w-[500px] aspect-square lg:max-w-none lg:w-auto ${
                  isChatOpen
                    ? "lg:h-[min(70vh,500px)] xl:h-[min(75vh,calc(100vw-856px))]"
                    : "lg:h-[70vh] xl:h-[75vh]"
                }`}
              >
                <MiningGrid
                  blocks={blocks}
                  selectedBlocks={selectedBlocks}
                  lockedBlocks={lockedBlocks}
                  pendingBlocks={pendingBlocks}
                  roundPhase={roundPhase}
                  dissolveProgressByBlock={dissolveProgressByBlock}
                  resolutionWinningBlock={resolutionWinningBlock}
                  isCinematicLocked={isCinematicLocked}
                  isWinnerRevealed={isWinnerRevealed}
                  onBlockSelect={handleBlockSelect}
                />
              </div>

              {/* History - matches grid width */}
              <div className="w-full max-w-[500px] lg:max-w-[70vh] xl:max-w-[75vh]">
                <RoundHistory history={roundHistory} />
              </div>
            </div>

            {/* Right Column: Control Panel (Natural Flow next to Grid) */}
            <aside className="w-full max-w-[500px] lg:max-w-none lg:w-[360px] flex-shrink-0 lg:sticky lg:top-0">
              <ControlPanel
                selectedBlocks={selectedBlocks}
                lockedBlocks={lockedBlocks}
                deployAmount={deployAmount}
                onDeployAmountChange={setDeployAmount}
                onSelectAll={handleSelectAll}
                onClearSelection={handleClearSelection}
                onDeploy={handleDeploy}
                onCashOut={handleCashOut}
                roundNumber={roundNumber}
                timeRemaining={timeRemaining}
                timerRemainingMs={timerRemainingMs}
                timerTotalMs={timerTotalMs}
                timerMessage={timerMessage}
                totalDeployed={totalDeployed}
                youDeployedSol={youDeployedSol}
                walletBalanceSol={walletBalanceSol}
                walletBalanceLoading={walletBalanceLoading}
                cashOutAvailableSol={cashOutAvailableSol}
                cashOutAvailableLoading={cashOutAvailableLoading}
                cashOutAvailableError={cashOutAvailableError}
                cashOutSettlementState={cashOutSettlementState}
                cashOutSettlementKind={cashOutSettlementKind}
                cashOutSettlementRoundId={cashOutSettlementRoundId}
                cashOutPendingWinningsSol={cashOutPendingWinningsSol}
                cashOutErrorMessage={cashOutErrorMessage}
                onRetryCashOutAvailable={retryCashOutAvailable}
                solPriceUsd={solPriceUsd}
                solPriceLoading={solPriceLoading}
                minersCount={minersCount}
                motherlode={motherlode}
                roundPhase={roundPhase}
                isAwaitingRoundEnd={isAwaitingRoundEnd}
                isShowingWinner={isShowingWinner}
                winnerCountdown={winnerCountdown}
                roundResult={roundResult}
                resolutionRpcUrl={resolutionRpcUrl}
                isDeployPending={isDeployPending}
                isCashOutPending={isCashOutPending}
                isDeployBlockedByRuntime={isDeployBlockedByRuntime}
              />
            </aside>
          </div>
        </section>
      </main>
    </div>
  );
}
