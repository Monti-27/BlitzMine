"use client";

import { createContext, useContext, type ReactNode } from "react";

export type AuthLifecycleState =
  | "idle"
  | "wallet_connected"
  | "privy_verified"
  | "backend_authenticated"
  | "socket_authenticated"
  | "failed";

interface AuthState {
  ready: boolean;
  authenticated: boolean;
  backendAuthenticated: boolean;
  authState: AuthLifecycleState;
  authError: string | null;
  wallet: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  ensureBackendAuth: (options?: { force?: boolean }) => Promise<boolean>;
  setSocketAuthenticated: (authenticated: boolean) => void;
}

const defaultAuth: AuthState = {
  ready: true,
  authenticated: false,
  backendAuthenticated: false,
  authState: "idle",
  authError: null,
  wallet: null,
  login: async () => {},
  logout: async () => {},
  ensureBackendAuth: async () => false,
  setSocketAuthenticated: () => {},
};

const AuthContext = createContext<AuthState>(defaultAuth);

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function AuthProvider({
  children,
  value,
}: {
  children: ReactNode;
  value?: AuthState;
}) {
  return (
    <AuthContext.Provider value={value ?? defaultAuth}>
      {children}
    </AuthContext.Provider>
  );
}
