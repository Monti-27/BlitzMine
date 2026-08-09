"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useUserProfile } from "@/contexts/user-profile-context";
import { useAuth } from "@/hooks/use-auth";
import {
  fetchChatMessages,
  fetchProfileHoverBatch,
  type ProfileHoverResponse,
} from "@/lib/api";
import { getCachedAccessToken } from "@/lib/auth-client";
import { useWebSocketContext } from "@/providers/socket-provider";
import type {
  HomeChatMessage,
  HomeChatTab,
  ReplyContext,
  UserProfileData,
} from "../models/home-chat.types";

type HoverCacheEntry =
  | { status: "loading"; data: UserProfileData; updatedAt: number }
  | { status: "ready"; data: UserProfileData; updatedAt: number }
  | { status: "error"; data: UserProfileData; updatedAt: number };

type ChatRoom = "general";

type PendingOutboundMessage = {
  clientMessageId: string;
  room: ChatRoom;
  content: string;
  sent: boolean;
  sentAtMs?: number;
  replyToId?: string | null;
};

type ChatGateState =
  | "CONNECT_WALLET"
  | "SIGNING_IN"
  | "CONNECTING_SOCKET"
  | "READY";

const PENDING_TIMEOUT_MS = 15_000;
const INITIAL_HISTORY_LIMIT = 60;
const CHAT_HISTORY_CACHE_LIMIT = 120;
const HOVER_CACHE_TTL_MS = 15_000;
const CHAT_AUTH_DEBUG = process.env.NEXT_PUBLIC_AUTH_DEBUG === "true";
const CHAT_HISTORY_CACHE_KEYS: Record<ChatRoom, string> = {
  general: "blitzmine_chat_history_general_v1",
};

function readChatHistoryCache(room: ChatRoom): HomeChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHAT_HISTORY_CACHE_KEYS[room]);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const normalized: HomeChatMessage[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const raw = item as Partial<HomeChatMessage> & { sender?: string };
      const walletAddress =
        typeof raw.walletAddress === "string"
          ? raw.walletAddress
          : typeof raw.sender === "string"
            ? raw.sender
            : null;
      if (!walletAddress) continue;
      if (typeof raw.id !== "string") continue;
      if (typeof raw.message !== "string") continue;
      if (typeof raw.timestamp !== "string") continue;

      normalized.push({
        id: raw.id,
        walletAddress,
        createdAt:
          typeof raw.createdAt === "string"
            ? raw.createdAt
            : new Date().toISOString(),
        clientMessageId:
          typeof raw.clientMessageId === "string"
            ? raw.clientMessageId
            : undefined,
        message: raw.message,
        timestamp: raw.timestamp,
        deliveryStatus: raw.deliveryStatus,
        isLocal: raw.isLocal,
      });
    }

    return normalized.slice(-CHAT_HISTORY_CACHE_LIMIT);
  } catch {
    return [];
  }
}

function writeChatHistoryCache(
  room: ChatRoom,
  messages: HomeChatMessage[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CHAT_HISTORY_CACHE_KEYS[room],
      JSON.stringify(messages.slice(-CHAT_HISTORY_CACHE_LIMIT)),
    );
  } catch {}
}

function createClientMessageId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    crypto.getRandomValues(bytes);
  } else {
    const seed = Date.now();
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = (seed >> (i % 8)) & 0xff;
    }
  }
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function toTimestampLabel(isoLike: string): string {
  const date = new Date(isoLike);
  if (Number.isNaN(date.getTime())) return "00:00";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function shortWallet(wallet: string): string {
  if (wallet.length <= 10) return wallet;
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

function colorFromKey(key: string): string {
  const colors = [
    "bg-blue-500",
    "bg-purple-500",
    "bg-emerald-500",
    "bg-pink-500",
    "bg-cyan-500",
    "bg-indigo-500",
    "bg-orange-500",
    "bg-teal-500",
  ];
  return colors[hashString(key) % colors.length];
}

function placeholderProfile(
  walletAddress: string,
  state: "loading" | "unavailable" = "loading",
): UserProfileData {
  return {
    username: shortWallet(walletAddress),
    walletAddress,
    avatarColor: colorFromKey(walletAddress),
    loading: state === "loading",
    unavailable: state === "unavailable",
  };
}

function mapBackendHover(
  hover: ProfileHoverResponse,
  walletAddress: string,
): UserProfileData {
  return {
    username: hover.username ?? shortWallet(walletAddress),
    walletAddress: hover.walletAddress,
    avatarColor: hover.avatarColor || colorFromKey(walletAddress),
    avatarImage: hover.avatarImage ?? undefined,
    rank: hover.rank ?? undefined,
    deployedSol: hover.deployedSol,
    roundsPlayed: hover.roundsPlayed,
    motherlodeHits: hover.motherlodeHits,
    loading: false,
    unavailable: false,
  };
}

function mapBackendMessageToHomeMessage(message: {
  id: string;
  sender: string;
  content: string;
  createdAt: string;
  clientMessageId?: string;
  replyToId?: string | null;
  replyTo?: { id: string; sender: string; contentPreview: string } | null;
  reactions?: Array<{ emoji: string; count: number; reactors: string[] }>;
}): HomeChatMessage {
  return {
    id: message.id,
    walletAddress: message.sender,
    createdAt: message.createdAt,
    clientMessageId: message.clientMessageId,
    message: message.content,
    timestamp: toTimestampLabel(message.createdAt),
    deliveryStatus: "sent",
    replyToId: message.replyToId ?? undefined,
    replyTo: message.replyTo ?? undefined,
    reactions: message.reactions ?? [],
  };
}

function upsertMessage(
  messages: HomeChatMessage[],
  incoming: HomeChatMessage,
): HomeChatMessage[] {
  if (messages.some((message) => message.id === incoming.id)) {
    return messages;
  }
  const next = [...messages, incoming];
  if (next.length <= 250) return next;
  return next.slice(next.length - 250);
}

function replacePendingMessage(
  messages: HomeChatMessage[],
  clientMessageId: string,
  serverMessage: HomeChatMessage,
): HomeChatMessage[] {
  const index = messages.findIndex(
    (message) =>
      message.clientMessageId === clientMessageId ||
      message.id === `pending:${clientMessageId}`,
  );
  if (index === -1) {
    return upsertMessage(messages, serverMessage);
  }
  const next = [...messages];
  next[index] = serverMessage;
  return next;
}

export function useHomeChatController(
  controlledIsOpen?: boolean,
  controlledOnToggle?: (isOpen: boolean) => void,
) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [activeTab, setActiveTab] = useState<HomeChatTab>("chat");
  const [messages, setMessages] = useState<HomeChatMessage[]>([]);
  const [replyContext, setReplyContext] = useState<ReplyContext | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [, setCacheVersion] = useState(0);

  const {
    authenticated,
    backendAuthenticated,
    authState,
    wallet,
    login,
    ensureBackendAuth,
  } = useAuth();
  const { userName, userPfp } = useUserProfile();
  const {
    isConnected,
    chatAuthed,
    canSendMessages,
    socketInstanceId,
    authenticateWithToken,
    sendChatMessage,
    joinRoom,
    onChatMessage,
    onMessageAck,
    onMessageError,
    toggleReaction: wsToggleReaction,
    onReactionUpdate,
  } = useWebSocketContext();

  const isOpen =
    controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const onToggle = controlledOnToggle ?? setInternalIsOpen;
  const canSend = canSendMessages;
  const composerGateState = useMemo<ChatGateState>(() => {
    if (canSend) return "READY";
    if (!authenticated || !wallet) return "CONNECT_WALLET";
    if (!backendAuthenticated || authState === "failed") return "SIGNING_IN";
    return "CONNECTING_SOCKET";
  }, [canSend, authenticated, wallet, backendAuthenticated, authState]);
  const chatDisabledPlaceholder = useMemo(() => {
    if (composerGateState === "CONNECT_WALLET") return "Connect wallet";
    if (composerGateState === "SIGNING_IN") return "Sign in to chat";
    if (!isConnected) return "Connecting chat...";
    return "Connecting socket...";
  }, [composerGateState, isConnected]);

  const userProfileCacheRef = useRef(new Map<string, HoverCacheEntry>());
  const pendingOutboundRef = useRef(new Map<string, PendingOutboundMessage>());
  const pendingTimeoutsRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const wsAuthDispatchedKeyRef = useRef<string | null>(null);
  const toastDedupRef = useRef(new Map<string, number>());

  const notify = useCallback(
    (
      level: "info" | "warning" | "error" | "success",
      message: string,
      id: string,
      minIntervalMs = 1200,
    ) => {
      const now = Date.now();
      const last = toastDedupRef.current.get(id) ?? 0;
      if (now - last < minIntervalMs) return;
      toastDedupRef.current.set(id, now);
      toast[level](message, { id });
    },
    [],
  );

  const handleDisabledInputAction = useCallback(async () => {
    if (composerGateState !== "SIGNING_IN") return;
    if (CHAT_AUTH_DEBUG) {
      console.info("[chat-auth] user triggered inline chat sign-in action");
    }
    try {
      await login();
    } catch {
      notify("error", "Sign-in was cancelled.", "chat-signin-cancelled");
      if (CHAT_AUTH_DEBUG) {
        console.warn(
          "[chat-auth] inline chat sign-in failed before backend auth",
        );
      }
      return;
    }
    const ok = await ensureBackendAuth({ force: true });
    if (!ok) {
      notify("error", "Sign in to continue.", "chat-signin-required");
    }
  }, [composerGateState, login, ensureBackendAuth, notify]);

  const bumpCacheVersion = useCallback(() => {
    setCacheVersion((value) => value + 1);
  }, []);

  const setHoverCacheBatch = useCallback(
    (entries: Array<{ key: string; entry: HoverCacheEntry }>) => {
      if (entries.length === 0) return;
      for (const { key, entry } of entries) {
        userProfileCacheRef.current.set(key, entry);
      }
      bumpCacheVersion();
    },
    [bumpCacheVersion],
  );

  const setRoomLoading = useCallback((_room: ChatRoom, isLoading: boolean) => {
    setHistoryLoading(isLoading);
  }, []);

  const setMessageDeliveryState = useCallback(
    (clientMessageId: string, status: "pending" | "failed") => {
      const update = (prev: HomeChatMessage[]) =>
        prev.map((message) => {
          if (
            message.clientMessageId !== clientMessageId &&
            message.id !== `pending:${clientMessageId}`
          ) {
            return message;
          }
          return {
            ...message,
            deliveryStatus: status,
          };
        });

      setMessages(update);
    },
    [],
  );

  const clearPendingTimer = useCallback((clientMessageId: string) => {
    const timer = pendingTimeoutsRef.current.get(clientMessageId);
    if (timer) {
      clearTimeout(timer);
      pendingTimeoutsRef.current.delete(clientMessageId);
    }
  }, []);

  const armPendingTimer = useCallback(
    (clientMessageId: string) => {
      clearPendingTimer(clientMessageId);
      const timer = setTimeout(() => {
        const pending = pendingOutboundRef.current.get(clientMessageId);
        if (!pending) return;
        pending.sent = false;
        pendingOutboundRef.current.set(clientMessageId, pending);
        setMessageDeliveryState(clientMessageId, "failed");
      }, PENDING_TIMEOUT_MS);
      pendingTimeoutsRef.current.set(clientMessageId, timer);
    },
    [clearPendingTimer, setMessageDeliveryState],
  );

  const dispatchPendingMessage = useCallback(
    (clientMessageId: string): boolean => {
      const pending = pendingOutboundRef.current.get(clientMessageId);
      if (!pending || !canSend) {
        if (CHAT_AUTH_DEBUG) {
          console.warn("[chat-send] blocked pending dispatch", {
            clientMessageId,
            reason: !pending ? "pending_not_found" : "socket_not_ready",
            gateState: composerGateState,
            isConnected,
            chatAuthed,
          });
        }
        return false;
      }
      if (pending.sent) return true;

      const sent = sendChatMessage({
        clientMessageId,
        content: pending.content,
        room: pending.room,
        ...(pending.replyToId ? { replyToId: pending.replyToId } : {}),
      });
      if (!sent) {
        if (CHAT_AUTH_DEBUG) {
          console.warn("[chat-send] blocked by websocket transport", {
            clientMessageId,
            room: pending.room,
          });
        }
        return false;
      }

      if (CHAT_AUTH_DEBUG) {
        console.info("[chat-send] message emitted", {
          clientMessageId,
          room: pending.room,
          socketInstanceId,
        });
      }

      pending.sent = true;
      pending.sentAtMs = Date.now();
      pendingOutboundRef.current.set(clientMessageId, pending);
      setMessageDeliveryState(clientMessageId, "pending");
      armPendingTimer(clientMessageId);
      return true;
    },
    [
      armPendingTimer,
      canSend,
      composerGateState,
      isConnected,
      chatAuthed,
      socketInstanceId,
      sendChatMessage,
      setMessageDeliveryState,
    ],
  );

  const queueOptimisticMessage = useCallback(
    (room: ChatRoom, content: string, replyCtx?: ReplyContext | null) => {
      const clientMessageId = createClientMessageId();
      const senderWallet = wallet ?? "unknown-wallet";
      const createdAt = new Date().toISOString();
      const optimistic: HomeChatMessage = {
        id: `pending:${clientMessageId}`,
        walletAddress: senderWallet,
        createdAt,
        clientMessageId,
        message: content,
        timestamp: toTimestampLabel(createdAt),
        deliveryStatus: "pending",
        isLocal: true,
        ...(replyCtx
          ? {
              replyToId: replyCtx.messageId,
              replyTo: {
                id: replyCtx.messageId,
                sender: replyCtx.sender,
                username: replyCtx.username,
                contentPreview: replyCtx.contentPreview,
              },
            }
          : {}),
      };

      pendingOutboundRef.current.set(clientMessageId, {
        clientMessageId,
        room,
        content,
        sent: false,
        replyToId: replyCtx?.messageId ?? null,
      });

      setMessages((prev) => upsertMessage(prev, optimistic));

      return clientMessageId;
    },
    [wallet],
  );

  const removePendingOptimisticMessage = useCallback(
    (clientMessageId: string) => {
      pendingOutboundRef.current.delete(clientMessageId);
      clearPendingTimer(clientMessageId);

      const pendingId = `pending:${clientMessageId}`;
      setMessages((prev) =>
        prev.filter(
          (message) =>
            message.clientMessageId !== clientMessageId &&
            message.id !== pendingId,
        ),
      );
    },
    [clearPendingTimer],
  );

  const retryMessage = useCallback(
    (clientMessageId: string) => {
      const pending = pendingOutboundRef.current.get(clientMessageId);
      if (!pending) return;
      if (!canSend) {
        notify(
          "info",
          "Chat is reconnecting. Try again in a moment.",
          "chat-retry-blocked",
        );
        if (CHAT_AUTH_DEBUG) {
          console.warn("[chat-send] retry blocked; socket not ready", {
            clientMessageId,
            gateState: composerGateState,
            isConnected,
            chatAuthed,
          });
        }
        return;
      }
      pending.sent = false;
      pending.sentAtMs = undefined;
      pendingOutboundRef.current.set(clientMessageId, pending);
      setMessageDeliveryState(clientMessageId, "pending");
      const sent = dispatchPendingMessage(clientMessageId);
      if (!sent) {
        setMessageDeliveryState(clientMessageId, "failed");
      }
    },
    [
      canSend,
      composerGateState,
      isConnected,
      chatAuthed,
      dispatchPendingMessage,
      setMessageDeliveryState,
      notify,
    ],
  );

  const prefetchHoverBatch = useCallback(
    async (wallets: string[]) => {
      if (wallets.length === 0) return;
      const uniqueWallets = Array.from(new Set(wallets));
      const now = Date.now();

      const pending = uniqueWallets.filter((walletAddress) => {
        const cacheKey = `wallet:${walletAddress}`;
        const existing = userProfileCacheRef.current.get(cacheKey);
        if (!existing) return true;
        if (existing.status === "loading") return false;
        if (existing.status === "error") return true;
        return now - existing.updatedAt > HOVER_CACHE_TTL_MS;
      });
      if (pending.length === 0) return;

      const loadingEntries = pending
        .filter((walletAddress) => {
          const existing = userProfileCacheRef.current.get(
            `wallet:${walletAddress}`,
          );
          return !existing;
        })
        .map((walletAddress) => ({
          key: `wallet:${walletAddress}`,
          entry: {
            status: "loading" as const,
            updatedAt: Date.now(),
            data: placeholderProfile(walletAddress, "loading"),
          },
        }));

      if (loadingEntries.length > 0) {
        setHoverCacheBatch(loadingEntries);
      }

      try {
        const chunkSize = 100;
        for (let index = 0; index < pending.length; index += chunkSize) {
          const chunk = pending.slice(index, index + chunkSize);
          const result = await fetchProfileHoverBatch(chunk);
          const entries = result.profiles.map((entry) => {
            const cacheKey = `wallet:${entry.wallet}`;
            if (entry.data) {
              return {
                key: cacheKey,
                entry: {
                  status: "ready" as const,
                  updatedAt: Date.now(),
                  data: mapBackendHover(entry.data, entry.wallet),
                },
              };
            }
            return {
              key: cacheKey,
              entry: {
                status: "error" as const,
                updatedAt: Date.now(),
                data: placeholderProfile(entry.wallet, "unavailable"),
              },
            };
          });
          setHoverCacheBatch(entries);
        }
      } catch {
        setHoverCacheBatch(
          pending.map((walletAddress) => ({
            key: `wallet:${walletAddress}`,
            entry: {
              status: "error" as const,
              updatedAt: Date.now(),
              data: placeholderProfile(walletAddress, "unavailable"),
            },
          })),
        );
      }
    },
    [setHoverCacheBatch],
  );

  const getUserProfile = useCallback(
    (walletAddress?: string): UserProfileData | null => {
      if (!walletAddress) return null;
      const cacheKey = `wallet:${walletAddress}`;
      const cached = userProfileCacheRef.current.get(cacheKey);
      if (cached) {
        return cached.data;
      }
      return placeholderProfile(walletAddress, "loading");
    },
    [],
  );

  const loadRoomHistory = useCallback(
    async (room: ChatRoom) => {
      setRoomLoading(room, true);
      try {
        const fetched = await fetchChatMessages(INITIAL_HISTORY_LIMIT);
        const mapped = fetched
          .slice()
          .reverse()
          .map((message) => mapBackendMessageToHomeMessage(message));
        setMessages(mapped);
      } catch {
      } finally {
        setRoomLoading(room, false);
      }
    },
    [setRoomLoading],
  );

  useEffect(() => {
    const cachedGeneral = readChatHistoryCache("general");
    if (cachedGeneral.length > 0) {
      setMessages((prev) => (prev.length > 0 ? prev : cachedGeneral));
      setRoomLoading("general", false);
    }
  }, [setRoomLoading]);

  useEffect(() => {
    void loadRoomHistory("general");
  }, [loadRoomHistory]);

  useEffect(() => {
    const unsubscribe = onChatMessage((message) => {
      const mapped = mapBackendMessageToHomeMessage(message);
      if (CHAT_AUTH_DEBUG) {
        const selfMessage = wallet ? message.sender === wallet : false;
        console.info("[chat-recv] new_message received", {
          messageId: message.id,
          room: message.room,
          selfMessage,
          hasClientMessageId: Boolean(message.clientMessageId),
        });
      }

      if (message.room !== "general") return;
      if (message.clientMessageId) {
        clearPendingTimer(message.clientMessageId);
        pendingOutboundRef.current.delete(message.clientMessageId);
        setMessages((prev) =>
          replacePendingMessage(
            prev,
            message.clientMessageId as string,
            mapped,
          ),
        );
      } else {
        setMessages((prev) => upsertMessage(prev, mapped));
      }
      void prefetchHoverBatch([message.sender]);
    });
    return unsubscribe;
  }, [clearPendingTimer, onChatMessage, prefetchHoverBatch, wallet]);

  useEffect(() => {
    const unsubscribeAck = onMessageAck(({ clientMessageId, message }) => {
      const pending = pendingOutboundRef.current.get(clientMessageId);
      const sentAtMs = pending?.sentAtMs;
      clearPendingTimer(clientMessageId);
      pendingOutboundRef.current.delete(clientMessageId);

      if (CHAT_AUTH_DEBUG && typeof sentAtMs === "number") {
        console.info("[chat-send] message ack received", {
          clientMessageId,
          room: message.room,
          latencyMs: Date.now() - sentAtMs,
        });
      }

      const mapped = mapBackendMessageToHomeMessage(message);
      if (message.room !== "general") return;
      setMessages((prev) =>
        replacePendingMessage(prev, clientMessageId, mapped),
      );
      void prefetchHoverBatch([message.sender]);
    });

    const unsubscribeError = onMessageError((payload) => {
      const clientMessageId = payload.clientMessageId;
      if (!clientMessageId) return;
      const pending = pendingOutboundRef.current.get(clientMessageId);
      if (!pending) return;
      pending.sent = false;
      pendingOutboundRef.current.set(clientMessageId, pending);
      clearPendingTimer(clientMessageId);
      setMessageDeliveryState(clientMessageId, "failed");
      notify(
        "error",
        "Message failed to send. Tap retry.",
        `chat-message-error-${clientMessageId}`,
      );
    });

    return () => {
      unsubscribeAck();
      unsubscribeError();
    };
  }, [
    clearPendingTimer,
    onMessageAck,
    onMessageError,
    prefetchHoverBatch,
    setMessageDeliveryState,
    notify,
  ]);

  useEffect(() => {
    const unsubscribe = onReactionUpdate(
      (payload: {
        messageId: string;
        emoji: string;
        count: number;
        reactors: string[];
      }) => {
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== payload.messageId) return msg;
            const reactions = [...(msg.reactions ?? [])];
            const idx = reactions.findIndex((r) => r.emoji === payload.emoji);
            if (payload.count === 0) {
              return {
                ...msg,
                reactions: reactions.filter((r) => r.emoji !== payload.emoji),
              };
            }
            if (idx >= 0) {
              reactions[idx] = {
                emoji: payload.emoji,
                count: payload.count,
                reactors: payload.reactors,
              };
            } else {
              reactions.push({
                emoji: payload.emoji,
                count: payload.count,
                reactors: payload.reactors,
              });
            }
            return { ...msg, reactions: [...reactions] };
          }),
        );
      },
    );
    return unsubscribe;
  }, [onReactionUpdate]);

  useEffect(() => {
    const wallets = new Set<string>();
    for (const message of messages.slice(-120)) {
      if (message.walletAddress) wallets.add(message.walletAddress);
    }
    void prefetchHoverBatch(Array.from(wallets));
  }, [messages, prefetchHoverBatch]);

  useEffect(() => {
    if (!wallet || !backendAuthenticated) return;
    const cacheKey = `wallet:${wallet}`;
    const existing = userProfileCacheRef.current.get(cacheKey);
    const existingData =
      existing?.data ?? placeholderProfile(wallet, "loading");
    const normalizedName =
      userName?.trim().length && userName !== "Anonymous"
        ? userName.trim()
        : existingData.username || shortWallet(wallet);
    const normalizedAvatar = userPfp?.trim() ? userPfp.trim() : undefined;

    const changed =
      existingData.username !== normalizedName ||
      (existingData.avatarImage ?? null) !== (normalizedAvatar ?? null) ||
      existingData.walletAddress !== wallet;

    if (!changed && existing?.status === "ready") return;

    userProfileCacheRef.current.set(cacheKey, {
      status: "ready",
      updatedAt: Date.now(),
      data: {
        ...existingData,
        walletAddress: wallet,
        username: normalizedName,
        avatarImage: normalizedAvatar,
        loading: false,
        unavailable: false,
      },
    });
    bumpCacheVersion();
  }, [wallet, backendAuthenticated, userName, userPfp, bumpCacheVersion]);

  useEffect(() => {
    const interval = setInterval(() => {
      const wallets = Array.from(
        new Set(
          messages
            .slice(-120)
            .map((message) => message.walletAddress)
            .filter((walletAddress): walletAddress is string =>
              Boolean(walletAddress),
            ),
        ),
      );
      void prefetchHoverBatch(wallets);
    }, 15_000);

    return () => clearInterval(interval);
  }, [messages, prefetchHoverBatch]);

  useEffect(() => {
    if (messages.length === 0) return;
    writeChatHistoryCache("general", messages);
  }, [messages]);

  useEffect(() => {
    if (!isConnected || !authenticated || !wallet || chatAuthed) return;
    if (authState === "failed") {
      if (CHAT_AUTH_DEBUG) {
        console.warn(
          "[chat-auth] auth state failed; waiting for manual sign-in",
        );
      }
      return;
    }

    const token = getCachedAccessToken(wallet);
    if (backendAuthenticated && token) return;

    if (CHAT_AUTH_DEBUG) {
      console.info(
        "[chat-auth] backend auth not ready yet; waiting for auth state change",
      );
    }
    void ensureBackendAuth();
  }, [
    isConnected,
    authenticated,
    wallet,
    chatAuthed,
    authState,
    backendAuthenticated,
    ensureBackendAuth,
  ]);

  useEffect(() => {
    if (!isConnected || !authenticated || !wallet || chatAuthed) return;
    if (authState === "failed") return;

    const token = getCachedAccessToken(wallet);
    if (!backendAuthenticated || !token) {
      return;
    }

    const dispatchKey = `${socketInstanceId}:${token}`;
    if (wsAuthDispatchedKeyRef.current === dispatchKey) {
      return;
    }

    const dispatched = authenticateWithToken(token);
    if (!dispatched) return;
    wsAuthDispatchedKeyRef.current = dispatchKey;

    if (CHAT_AUTH_DEBUG) {
      console.info("[chat-auth] authenticate dispatched", {
        socketInstanceId,
      });
    }
  }, [
    isConnected,
    authenticated,
    wallet,
    chatAuthed,
    authState,
    backendAuthenticated,
    socketInstanceId,
    authenticateWithToken,
  ]);

  useEffect(() => {
    if (!isConnected || !chatAuthed) return;
    joinRoom("general");
  }, [isConnected, chatAuthed, joinRoom]);

  useEffect(() => {
    if (!canSend) return;
    for (const pending of pendingOutboundRef.current.values()) {
      if (!pending.sent) {
        dispatchPendingMessage(pending.clientMessageId);
      }
    }
  }, [canSend, dispatchPendingMessage]);

  useEffect(() => {
    return () => {
      for (const timer of pendingTimeoutsRef.current.values()) {
        clearTimeout(timer);
      }
      pendingTimeoutsRef.current.clear();
      pendingOutboundRef.current.clear();
    };
  }, []);

  const handleSendGlobal = useCallback(() => {
    const content = inputValue.trim();
    if (!content) return;
    if (!canSend) {
      if (composerGateState === "CONNECT_WALLET") {
        notify("warning", "Connect wallet to chat.", "chat-gate-wallet");
      } else if (composerGateState === "SIGNING_IN") {
        notify("warning", "Sign in to chat.", "chat-gate-signin");
      } else {
        notify("info", "Connecting chat...", "chat-gate-connecting");
      }
      return;
    }

    const currentReplyCtx = replyContext;
    const clientMessageId = queueOptimisticMessage(
      "general",
      content,
      currentReplyCtx,
    );
    setInputValue("");
    setReplyContext(null);
    const sent = dispatchPendingMessage(clientMessageId);
    if (!sent) {
      removePendingOptimisticMessage(clientMessageId);
      setInputValue(content);
      if (currentReplyCtx) setReplyContext(currentReplyCtx);
    }
  }, [
    canSend,
    composerGateState,
    dispatchPendingMessage,
    inputValue,
    notify,
    queueOptimisticMessage,
    removePendingOptimisticMessage,
    replyContext,
  ]);

  const handleToggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      if (!canSend || !wallet) return;
      const currentWallet = wallet;
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== messageId) return msg;
          const reactions = [...(msg.reactions ?? [])];
          const existing = reactions.find((r) => r.emoji === emoji);
          if (existing) {
            const isMine = existing.reactors.includes(currentWallet);
            if (isMine) {
              existing.count = Math.max(0, existing.count - 1);
              existing.reactors = existing.reactors.filter(
                (r) => r !== currentWallet,
              );
              if (existing.count === 0) {
                return {
                  ...msg,
                  reactions: reactions.filter((r) => r.emoji !== emoji),
                };
              }
            } else {
              existing.count += 1;
              existing.reactors = [...existing.reactors, currentWallet];
            }
            return { ...msg, reactions: [...reactions] };
          }
          return {
            ...msg,
            reactions: [
              ...reactions,
              { emoji, count: 1, reactors: [currentWallet] },
            ],
          };
        }),
      );
      wsToggleReaction(messageId, emoji);
    },
    [canSend, wallet, wsToggleReaction],
  );

  const handleSetReplyContext = useCallback((msg: HomeChatMessage) => {
    setReplyContext({
      messageId: msg.id,
      sender: msg.walletAddress ?? "",
      username: msg.username,
      contentPreview: msg.message.slice(0, 80),
    });
  }, []);

  const handleClearReplyContext = useCallback(() => {
    setReplyContext(null);
  }, []);

  return {
    isOpen,
    onToggle,
    inputValue,
    setInputValue,
    activeTab,
    setActiveTab,
    messages: useMemo(() => messages, [messages]),
    getUserProfile,
    isGlobalHistoryLoading: historyLoading,
    inputDisabled: !canSend,
    inputDisabledPlaceholder: chatDisabledPlaceholder,
    inputDisabledActionLabel:
      composerGateState === "SIGNING_IN" ? "Sign in" : undefined,
    onInputDisabledAction:
      composerGateState === "SIGNING_IN"
        ? handleDisabledInputAction
        : undefined,
    onSendGlobal: handleSendGlobal,
    onRetryGlobal: retryMessage,
    currentWallet: wallet ?? undefined,
    onToggleReaction: handleToggleReaction,
    replyContext,
    onSetReplyContext: handleSetReplyContext,
    onClearReplyContext: handleClearReplyContext,
  };
}
