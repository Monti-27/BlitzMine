"use client";

import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserProfileProvider } from "@/contexts/user-profile-context";
import { PrivyProvider } from "./privy-provider";
import { QueryProvider } from "./query-provider";
import { WebSocketProvider } from "./socket-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider>
      <QueryProvider>
        <WebSocketProvider>
          <UserProfileProvider>
            <TooltipProvider>
              {children}
              <Toaster
                position="bottom-right"
                richColors
                closeButton
                duration={4000}
              />
            </TooltipProvider>
          </UserProfileProvider>
        </WebSocketProvider>
      </QueryProvider>
    </PrivyProvider>
  );
}
