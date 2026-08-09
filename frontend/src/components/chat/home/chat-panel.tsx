"use client";

import { Chat } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "framer-motion";
import { useHomeChatController } from "./hooks/use-home-chat-controller";
import { ChatTabs } from "./sections/chat-tabs";
import { GlobalChatView } from "./sections/global-chat-view";
import { NoteView } from "./sections/news-view";

interface ChatPanelProps {
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
}

export function ChatPanel({
  isOpen: controlledIsOpen,
  onToggle: controlledOnToggle,
}: ChatPanelProps = {}) {
  const {
    isOpen,
    onToggle,
    inputValue,
    setInputValue,
    activeTab,
    setActiveTab,
    messages,
    getUserProfile,
    isGlobalHistoryLoading,
    inputDisabled,
    inputDisabledPlaceholder,
    inputDisabledActionLabel,
    onInputDisabledAction,
    onSendGlobal,
    onRetryGlobal,
    currentWallet,
    onToggleReaction,
    replyContext,
    onSetReplyContext,
    onClearReplyContext,
  } = useHomeChatController(controlledIsOpen, controlledOnToggle);

  return (
    <>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{
              opacity: 0,
              scale: 0.9,
              y: -20,
              x: -20,
              filter: "blur(8px)",
            }}
            animate={{ opacity: 1, scale: 1, y: 0, x: 0, filter: "blur(0px)" }}
            exit={{
              opacity: 0,
              scale: 0.9,
              y: -20,
              x: -20,
              filter: "blur(8px)",
            }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            data-hover-boundary
            className="fixed top-24 lg:top-28 left-4 z-50 w-[calc(100vw-32px)] lg:w-[416px] h-[85vh] max-h-[90vh] flex flex-col rounded-lg overflow-hidden bg-[#0A0A0A]/90 backdrop-blur-2xl border border-white/10 shadow-2xl selection:bg-primary/30"
          >
            <ChatTabs
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onClose={() => onToggle(false)}
            />

            {activeTab === "chat" && (
              <GlobalChatView
                messages={messages}
                inputValue={inputValue}
                onInputChange={setInputValue}
                onSubmit={onSendGlobal}
                inputDisabled={inputDisabled}
                disabledPlaceholder={inputDisabledPlaceholder}
                disabledActionLabel={inputDisabledActionLabel}
                onDisabledAction={onInputDisabledAction}
                getUserProfile={getUserProfile}
                isLoadingHistory={isGlobalHistoryLoading}
                onRetryMessage={onRetryGlobal}
                currentWallet={currentWallet}
                onToggleReaction={onToggleReaction}
                replyContext={replyContext}
                onReply={onSetReplyContext}
                onClearReply={onClearReplyContext}
              />
            )}

            {activeTab === "news" && <NoteView />}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!isOpen && (
          <motion.button
            type="button"
            aria-label="Open chat"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onToggle(true)}
            className="fixed bottom-6 right-6 lg:top-28 lg:left-4 lg:bottom-auto lg:right-auto z-50 p-4 lg:p-3 rounded-full bg-primary text-primary-foreground lg:bg-transparent lg:text-muted-foreground lg:hover:text-foreground shadow-lg lg:shadow-none transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-95"
          >
            <Chat
              className="w-8 h-8 relative z-10"
              weight="fill"
              aria-hidden="true"
            />
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}
