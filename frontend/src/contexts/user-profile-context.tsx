"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { fetchMyProfile } from "@/lib/api";

interface UserProfile {
  userName: string;
  userPfp: string;
  setUserName: (name: string) => void;
  setUserPfp: (pfp: string) => void;
}

const UserProfileContext = createContext<UserProfile | null>(null);

export function UserProfileProvider({ children }: { children: ReactNode }) {
  const [userName, setUserName] = useState("Anonymous");
  const [userPfp, setUserPfp] = useState("");
  const { wallet, backendAuthenticated } = useAuth();

  const profileQuery = useQuery({
    queryKey: ["profile-context", "me", wallet],
    queryFn: fetchMyProfile,
    enabled: backendAuthenticated && Boolean(wallet),
    refetchInterval: 45_000,
  });

  useEffect(() => {
    const profile = profileQuery.data;
    if (!profile) return;

    const nextName = profile.identity.displayName || "Anonymous";
    const nextAvatar = profile.identity.avatarUrl || "";

    if (nextName !== userName) {
      setUserName(nextName);
    }
    if (nextAvatar !== userPfp) {
      setUserPfp(nextAvatar);
    }
  }, [profileQuery.data, userName, userPfp]);

  useEffect(() => {
    if (backendAuthenticated) return;
    if (userName !== "Anonymous") setUserName("Anonymous");
    if (userPfp !== "") setUserPfp("");
  }, [backendAuthenticated, userName, userPfp]);

  return (
    <UserProfileContext.Provider value={{ userName, userPfp, setUserName, setUserPfp }}>
      {children}
    </UserProfileContext.Provider>
  );
}

export function useUserProfile() {
  const ctx = useContext(UserProfileContext);
  if (!ctx) throw new Error("useUserProfile must be used within UserProfileProvider");
  return ctx;
}
