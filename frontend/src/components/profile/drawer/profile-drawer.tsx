"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ProfileDrawerProps } from "./models/profile.types";
import { useProfileDrawerController } from "./hooks/use-profile-drawer-controller";
import { AvatarEditor } from "./sections/avatar-editor";
import { DrawerActions } from "./sections/drawer-actions";
import { StatsGrid } from "./sections/stats-grid";
import { WalletChip } from "./sections/wallet-chip";

export function ProfileDrawer({ open, onOpenChange }: ProfileDrawerProps) {
  const {
    userName,
    userPfp,
    setUserPfp,
    editing,
    setEditing,
    tempName,
    setTempName,
    copied,
    validationError,
    isSaving,
    walletDisplay,
    stats,
    handleSave,
    handleCopy,
    handleDisconnect,
  } = useProfileDrawerController(() => onOpenChange(false));

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-[3px]"
            onClick={() => onOpenChange(false)}
          />

          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{
              type: "spring",
              damping: 30,
              stiffness: 300,
              mass: 0.8,
            }}
            className="fixed inset-y-0 right-0 z-50 flex w-[340px] flex-col overflow-hidden border-l border-white/[0.08] bg-sidebar sm:w-[390px]"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.06),_transparent_48%)]" />

            <div className="relative z-10 flex justify-end p-5 pb-0">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-transparent text-white/30 transition-all duration-200 hover:border-white/[0.12] hover:text-white/80 hover:bg-white/[0.03]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative z-10 flex-1 overflow-y-auto px-8 pb-8 scrollbar-hide">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: 0.1,
                  duration: 0.5,
                  ease: [0.25, 0.46, 0.45, 0.94],
                }}
              >
                <AvatarEditor
                  userName={userName}
                  walletAddress={stats.walletAddress}
                  userPfp={userPfp}
                  editing={editing}
                  tempName={tempName}
                  setTempName={setTempName}
                  setEditing={setEditing}
                  setUserPfp={setUserPfp}
                  onSave={handleSave}
                />
                {validationError && (
                  <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-center text-xs text-red-300">
                    {validationError}
                  </div>
                )}
                {isSaving && (
                  <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-xs text-muted-foreground">
                    Saving profile...
                  </div>
                )}
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: 0.18,
                  duration: 0.5,
                  ease: [0.25, 0.46, 0.45, 0.94],
                }}
              >
                <WalletChip
                  walletAddress={walletDisplay}
                  copied={copied}
                  onCopy={handleCopy}
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: 0.26,
                  duration: 0.5,
                  ease: [0.25, 0.46, 0.45, 0.94],
                }}
              >
                <StatsGrid stats={stats} />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, scaleX: 0 }}
                animate={{ opacity: 1, scaleX: 1 }}
                transition={{
                  delay: 0.34,
                  duration: 0.6,
                  ease: [0.25, 0.46, 0.45, 0.94],
                }}
                className="mb-6 h-px bg-gradient-to-r from-transparent via-white/[0.12] to-transparent"
              />

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: 0.38,
                  duration: 0.5,
                  ease: [0.25, 0.46, 0.45, 0.94],
                }}
              >
                <DrawerActions
                  onClose={() => onOpenChange(false)}
                  onDisconnect={handleDisconnect}
                />
              </motion.div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
