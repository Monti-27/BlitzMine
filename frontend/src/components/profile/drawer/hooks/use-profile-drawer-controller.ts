"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useUserProfile } from "@/contexts/user-profile-context";
import { useAuth } from "@/hooks/use-auth";
import { fetchMyProfile, updateMyProfile } from "@/lib/api";

function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;

export function useProfileDrawerController(onClose: () => void) {
  const queryClient = useQueryClient();
  const { wallet, backendAuthenticated, logout } = useAuth();
  const { userName, userPfp, setUserName, setUserPfp } = useUserProfile();
  const [editing, setEditing] = useState(false);
  const [tempName, setTempName] = useState(userName);
  const [copied, setCopied] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ["profile-drawer", "me", wallet],
    queryFn: fetchMyProfile,
    enabled: backendAuthenticated && Boolean(wallet),
    refetchInterval: 45_000,
  });

  const saveMutation = useMutation({
    mutationFn: updateMyProfile,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["profile-context"] }),
        queryClient.invalidateQueries({ queryKey: ["profile-page"] }),
        queryClient.invalidateQueries({ queryKey: ["profile-drawer"] }),
      ]);
      toast.success("Profile saved.", { id: "profile-save-success" });
    },
    onError: () => {
      toast.error("Could not save profile now.", { id: "profile-save-error" });
    },
  });

  const profile = profileQuery.data;
  const walletAddress =
    profile?.identity.walletAddress ?? wallet ?? "Disconnected";
  const walletDisplay = shortenAddress(walletAddress);

  const stats = useMemo(
    () => ({
      rank: profile?.identity.rank ?? 0,
      deployedSol: profile?.stats.totalSolDeployed ?? 0,
      rounds: profile?.stats.roundsPlayed ?? 0,
      walletAddress,
    }),
    [profile, walletAddress],
  );

  const handleSave = async () => {
    const nextName = tempName.trim();

    if (!nextName) {
      setValidationError("Username cannot be empty.");
      return;
    }
    if (nextName.length < 3 || nextName.length > 20) {
      setValidationError("Username must be between 3 and 20 characters.");
      return;
    }
    if (!USERNAME_REGEX.test(nextName)) {
      setValidationError(
        "Username can contain only letters, numbers, and underscores.",
      );
      return;
    }

    setValidationError(null);
    try {
      await saveMutation.mutateAsync({
        username: nextName,
        ...(userPfp.startsWith("http://") || userPfp.startsWith("https://")
          ? { avatarUrl: userPfp }
          : {}),
      });
      setUserName(nextName);
      setEditing(false);
    } catch {}
  };

  const handleCopy = () => {
    navigator.clipboard
      .writeText(walletAddress)
      .then(() => {
        setCopied(true);
        toast.success("Wallet address copied.", {
          id: "profile-wallet-copied",
        });
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        toast.error("Could not copy wallet address.", {
          id: "profile-wallet-copy-failed",
        });
      });
  };

  const handleDisconnect = async () => {
    await logout();
    onClose();
  };

  return {
    userName,
    userPfp,
    setUserPfp,
    editing,
    setEditing,
    tempName,
    setTempName,
    copied,
    validationError,
    isSaving: saveMutation.isPending,
    walletDisplay,
    stats,
    handleSave,
    handleCopy,
    handleDisconnect,
    setUserName,
  };
}
