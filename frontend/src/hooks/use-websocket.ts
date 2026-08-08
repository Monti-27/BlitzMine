"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { WS_URL } from "@/lib/constants";
import type { RealtimeDeployment, RoundAccount } from "@/lib/types";
import { useChatStore } from "@/stores/chat-store";
import { useGameStore } from "@/stores/game-store";

const WS_DEBUG = process.env.NEXT_PUBLIC_AUTH_DEBUG === "true";
let wsInstanceCounter = 0;

type BackendWsChatMessage = {
  id: string;
  sender: string;
  content: string;
  room: string;
  createdAt: string;
  clientMessageId?: string;
};

type ChatMessageAckPayload = {
  clientMessageId: string;
  message: BackendWsChatMessage;
};

type ChatMessageErrorPayload = {
  clientMessageId: string | null;
  code: string;
  message: string;
};

type RoundEndPayload = {
  roundId: number;
  resolutionTxHash: string;
  winningBlock: number;
  totalWinningsLamports?: string;
};

type ReactionUpdatePayload = {
  messageId: string;
  emoji: string;
  count: number;
  reactors: string[];
  action: "added" | "removed";
  reactorWallet: string;
};

function toWebSocketBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "ws://localhost:3000";
  }

  if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) {
    return trimmed.replace(/\/+$/, "");
  }

  if (trimmed.startsWith("http://")) {
    return `ws://${trimmed.slice("http://".length).replace(/\/+$/, "")}`;
  }

  if (trimmed.startsWith("https://")) {
    return `wss://${trimmed.slice("https://".length).replace(/\/+$/, "")}`;
  }

  return `ws://${trimmed.replace(/\/+$/, "")}`;
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(true);
  const activeSocketIdRef = useRef<number>(0);
  const chatAuthedRef = useRef(false);
  const authAttemptKeyRef = useRef<string | null>(null);
  const outageActiveRef = useRef(false);
  const lastToastAtRef = useRef<Map<string, number>>(new Map());

  const [isConnected, setIsConnected] = useState(false);
  const [chatAuthed, setChatAuthed] = useState(false);
  const [socketInstanceId, setSocketInstanceId] = useState(0);

  const chatMessageListeners = useRef(
    new Set<(message: BackendWsChatMessage) => void>(),
  );
  const chatMessageAckListeners = useRef(
    new Set<(payload: ChatMessageAckPayload) => void>(),
  );
  const chatMessageErrorListeners = useRef(
    new Set<(payload: ChatMessageErrorPayload) => void>(),
  );
  const newDeployListeners = useRef(
    new Set<(payload: RealtimeDeployment) => void>(),
  );
  const roundEndListeners = useRef(
    new Set<(payload: RoundEndPayload) => void>(),
  );
  const reactionUpdateListeners = useRef(
    new Set<(payload: ReactionUpdatePayload) => void>(),
  );

  const setRound = useGameStore((s) => s.setRound);
  const setBoard = useGameStore((s) => s.setBoard);
  const { setConnected } = useChatStore();
  const queryClient = useQueryClient();
  const { setSocketAuthenticated } = useAuth();

  const setRoundRef = useRef(setRound);
  const setBoardRef = useRef(setBoard);
  const setConnectedRef = useRef(setConnected);
  const queryClientRef = useRef(queryClient);
  const setSocketAuthenticatedRef = useRef(setSocketAuthenticated);

  useEffect(() => {
    setRoundRef.current = setRound;
  }, [setRound]);

  useEffect(() => {
    setBoardRef.current = setBoard;
  }, [setBoard]);

  useEffect(() => {
    setConnectedRef.current = setConnected;
  }, [setConnected]);

  useEffect(() => {
    queryClientRef.current = queryClient;
  }, [queryClient]);

  useEffect(() => {
    setSocketAuthenticatedRef.current = setSocketAuthenticated;
  }, [setSocketAuthenticated]);

  useEffect(() => {
    chatAuthedRef.current = chatAuthed;
  }, [chatAuthed]);

  const clearReconnectTimer = useCallback(() => {
    const timer = reconnectTimerRef.current;
    if (timer) {
      clearTimeout(timer);
      reconnectTimerRef.current = null;
    }
  }, []);

  const notify = useCallback(
    (
      level: "success" | "warning" | "error" | "info",
      message: string,
      id: string,
      minIntervalMs = 1500,
    ) => {
      const now = Date.now();
      const last = lastToastAtRef.current.get(id) ?? 0;
      if (now - last < minIntervalMs) return;
      lastToastAtRef.current.set(id, now);
      toast[level](message, { id });
    },
    [],
  );

  const connect = useCallback(() => {
    clearReconnectTimer();

    const wsBase = toWebSocketBaseUrl(WS_URL);
    const wsUrl = `${wsBase}/ws`;
    const socket = new WebSocket(wsUrl);
    const prevSocket = wsRef.current;
    const nextSocketId = ++wsInstanceCounter;

    wsRef.current = socket;
    activeSocketIdRef.current = nextSocketId;
    setSocketInstanceId(nextSocketId);
    setIsConnected(false);
    setConnectedRef.current(false);
    setChatAuthed(false);
    setSocketAuthenticatedRef.current(false);
    authAttemptKeyRef.current = null;

    if (prevSocket && prevSocket.readyState !== WebSocket.CLOSED) {
      try {
        prevSocket.close(1000, "replaced");
      } catch {
        // best effort close
      }
    }

    const isCurrentSocket = () =>
      wsRef.current === socket && activeSocketIdRef.current === nextSocketId;

    if (WS_DEBUG) {
      console.info("[WS] socket instance created", {
        wsInstanceId: nextSocketId,
        wsUrl,
      });
    }

    socket.onopen = () => {
      if (!isCurrentSocket()) return;
      reconnectDelayRef.current = 1000;
      setIsConnected(true);
      setConnectedRef.current(true);
      authAttemptKeyRef.current = null;
      if (outageActiveRef.current) {
        notify("success", "Realtime connection restored.", "ws-reconnected", 0);
        outageActiveRef.current = false;
      }
      if (WS_DEBUG) {
        console.info("[WS] socket connected", { wsInstanceId: nextSocketId });
      }
    };

    socket.onclose = (event) => {
      if (!isCurrentSocket()) return;

      wsRef.current = null;
      setIsConnected(false);
      setConnectedRef.current(false);
      setChatAuthed(false);
      setSocketAuthenticatedRef.current(false);
      authAttemptKeyRef.current = null;

      if (WS_DEBUG) {
        console.info("[WS] socket disconnected", {
          wsInstanceId: nextSocketId,
          code: event.code,
          reason: event.reason,
        });
      }

      if (shouldReconnectRef.current) {
        if (!outageActiveRef.current) {
          notify(
            "warning",
            "Realtime connection lost. Reconnecting...",
            "ws-disconnected",
            0,
          );
          outageActiveRef.current = true;
        }
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, reconnectDelayRef.current);
      }
      reconnectDelayRef.current = Math.min(
        reconnectDelayRef.current * 2,
        30000,
      );
    };

    socket.onerror = () => {
      if (!isCurrentSocket()) return;
      if (WS_DEBUG) {
        console.warn("[WS] socket error", { wsInstanceId: nextSocketId });
      }
      socket.close();
    };

    socket.onmessage = (event) => {
      if (!isCurrentSocket()) return;

      let msg: { type: string; data: any };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "round_update":
          setRoundRef.current(msg.data as RoundAccount);
          break;
        case "board_update":
          setBoardRef.current(
            msg.data as {
              roundId: number;
              startSlot: number;
              endSlot: number | null;
            },
          );
          break;
        case "round_end":
          {
            const payload = msg.data as RoundEndPayload;
            const winnerBlock =
              Number.isInteger(payload.winningBlock) &&
              payload.winningBlock >= 1 &&
              payload.winningBlock <= 25
                ? payload.winningBlock
                : null;
            if (winnerBlock === null) {
              if (WS_DEBUG) {
                console.warn(
                  "[WS] round_end payload missing valid winningBlock",
                  {
                    wsInstanceId: nextSocketId,
                    payload: msg.data ?? null,
                  },
                );
              }
              break;
            }
            const normalizedPayload: RoundEndPayload = {
              ...payload,
              winningBlock: winnerBlock,
            };
            queryClientRef.current.refetchQueries({
              queryKey: ["round", "current", "mining-runtime"],
              type: "active",
            });
            queryClientRef.current.invalidateQueries({ queryKey: ["round"] });
            queryClientRef.current.invalidateQueries({ queryKey: ["miner"] });
            queryClientRef.current.invalidateQueries({
              queryKey: ["leaderboard"],
            });
            queryClientRef.current.invalidateQueries({
              queryKey: ["round-history", "recent"],
            });
            for (const listener of roundEndListeners.current) {
              try {
                listener(normalizedPayload);
              } catch (error) {
                console.error("[WS] round_end listener failed", error);
              }
            }
          }
          break;
        case "new_message":
          for (const listener of chatMessageListeners.current) {
            listener(msg.data as BackendWsChatMessage);
          }
          break;
        case "new_deploy":
          for (const listener of newDeployListeners.current) {
            listener(msg.data as RealtimeDeployment);
          }
          break;
        case "message_ack":
          for (const listener of chatMessageAckListeners.current) {
            listener(msg.data as ChatMessageAckPayload);
          }
          break;
        case "message_error":
          for (const listener of chatMessageErrorListeners.current) {
            listener(msg.data as ChatMessageErrorPayload);
          }
          break;
        case "authenticated":
          setChatAuthed(true);
          setSocketAuthenticatedRef.current(true);
          if (WS_DEBUG) {
            console.info("[WS] authenticated event received", {
              wsInstanceId: nextSocketId,
            });
          }
          break;
        case "auth_error": {
          const payload =
            msg.data && typeof msg.data === "object"
              ? (msg.data as { code?: unknown; message?: unknown })
              : {};
          const code = typeof payload.code === "string" ? payload.code : "";
          const shouldResetAuth =
            code === "INVALID_ACCESS_TOKEN" ||
            code === "MISSING_ACCESS_TOKEN" ||
            code === "SESSION_REVOKED" ||
            code === "NOT_AUTHENTICATED";
          if (shouldResetAuth) {
            setChatAuthed(false);
            setSocketAuthenticatedRef.current(false);
            notify(
              "error",
              "Session expired. Please sign in again.",
              `ws-auth-${code || "session"}`,
            );
          } else if (code) {
            notify(
              "error",
              "Realtime authentication failed.",
              `ws-auth-${code}`,
            );
          }
          if (WS_DEBUG) {
            console.warn("[WS] auth_error event received", {
              wsInstanceId: nextSocketId,
              data: msg.data ?? null,
              chatAuthedReset: shouldResetAuth,
            });
          }
          break;
        }
        case "pong":
          break;
      }
    };
  }, [clearReconnectTimer, notify]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();

    return () => {
      shouldReconnectRef.current = false;
      clearReconnectTimer();
      authAttemptKeyRef.current = null;
      activeSocketIdRef.current = 0;
      const socket = wsRef.current;
      wsRef.current = null;
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        socket.close(1000, "unmount");
      }
    };
  }, [connect, clearReconnectTimer]);

  const send = useCallback((type: string, data: any): boolean => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      if (WS_DEBUG) {
        console.warn("[WS] send blocked; socket not open", {
          type,
          readyState: socket?.readyState ?? "none",
          socketInstanceId: activeSocketIdRef.current || null,
        });
      }
      return false;
    }

    if (WS_DEBUG && type === "authenticate") {
      const token =
        typeof data?.accessToken === "string" ? data.accessToken : "";
      console.info("[WS] sending authenticate event", {
        socketInstanceId: activeSocketIdRef.current || null,
        tokenLen: token.length,
      });
    }

    socket.send(JSON.stringify({ type, data }));
    return true;
  }, []);

  const authenticateWithToken = useCallback(
    (accessToken: string): boolean => {
      const currentSocketId = activeSocketIdRef.current;
      if (!currentSocketId) {
        if (WS_DEBUG) {
          console.warn("[WS] authenticate blocked; no active socket");
        }
        return false;
      }

      const authAttemptKey = `${currentSocketId}:${accessToken}`;
      if (authAttemptKeyRef.current === authAttemptKey) {
        if (WS_DEBUG) {
          console.info(
            "[WS] authenticate skipped; already attempted for socket",
            {
              socketInstanceId: currentSocketId,
            },
          );
        }
        return false;
      }

      const sent = send("authenticate", { accessToken });
      if (sent) {
        authAttemptKeyRef.current = authAttemptKey;
      }
      return sent;
    },
    [send],
  );

  const sendChatMessage = useCallback(
    (payload: {
      clientMessageId: string;
      content: string;
      room?: string;
      replyToId?: string;
    }): boolean => {
      if (!chatAuthedRef.current) {
        if (WS_DEBUG) {
          console.warn("[WS] send_message blocked; socket not authenticated", {
            socketInstanceId: activeSocketIdRef.current || null,
            clientMessageId: payload.clientMessageId,
          });
        }
        return false;
      }
      return send("send_message", {
        clientMessageId: payload.clientMessageId,
        content: payload.content,
        ...(payload.room ? { room: payload.room } : {}),
        ...(payload.replyToId ? { replyToId: payload.replyToId } : {}),
      });
    },
    [send],
  );

  const joinRoom = useCallback(
    (room: string): boolean => {
      if (!chatAuthedRef.current) {
        if (WS_DEBUG) {
          console.warn("[WS] join_room blocked; socket not authenticated", {
            socketInstanceId: activeSocketIdRef.current || null,
            room,
          });
        }
        return false;
      }
      return send("join_room", { room });
    },
    [send],
  );

  const onChatMessage = useCallback(
    (listener: (message: BackendWsChatMessage) => void) => {
      chatMessageListeners.current.add(listener);
      return () => {
        chatMessageListeners.current.delete(listener);
      };
    },
    [],
  );

  const onMessageAck = useCallback(
    (listener: (payload: ChatMessageAckPayload) => void) => {
      chatMessageAckListeners.current.add(listener);
      return () => {
        chatMessageAckListeners.current.delete(listener);
      };
    },
    [],
  );

  const onMessageError = useCallback(
    (listener: (payload: ChatMessageErrorPayload) => void) => {
      chatMessageErrorListeners.current.add(listener);
      return () => {
        chatMessageErrorListeners.current.delete(listener);
      };
    },
    [],
  );

  const onNewDeploy = useCallback(
    (listener: (payload: RealtimeDeployment) => void) => {
      newDeployListeners.current.add(listener);
      return () => {
        newDeployListeners.current.delete(listener);
      };
    },
    [],
  );

  const onRoundEnd = useCallback(
    (listener: (payload: RoundEndPayload) => void) => {
      roundEndListeners.current.add(listener);
      return () => {
        roundEndListeners.current.delete(listener);
      };
    },
    [],
  );

  const onReactionUpdate = useCallback(
    (listener: (payload: ReactionUpdatePayload) => void) => {
      reactionUpdateListeners.current.add(listener);
      return () => {
        reactionUpdateListeners.current.delete(listener);
      };
    },
    [],
  );

  const toggleReaction = useCallback(
    (messageId: string, emoji: string): boolean => {
      return send("toggle_reaction", { messageId, emoji });
    },
    [send],
  );

  useEffect(() => {
    if (WS_DEBUG) {
      console.info("[WS] chatAuthed =", chatAuthed);
    }
  }, [chatAuthed]);

  return {
    send,
    authenticateWithToken,
    sendChatMessage,
    joinRoom,
    onChatMessage,
    onMessageAck,
    onMessageError,
    onNewDeploy,
    onRoundEnd,
    onReactionUpdate,
    toggleReaction,
    isConnected,
    chatAuthed,
    socketInstanceId,
    canSendMessages: isConnected && chatAuthed,
  };
}
