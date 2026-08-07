import { HttpException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { IncomingMessage as HttpIncomingMessage } from 'http';
import * as WebSocket from 'ws';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { ChatService, RealtimeChatMessage } from '../chat/chat.service';
import { AuthService } from '../auth/auth.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';

interface ClientMeta {
  wallet: string | null;
  alive: boolean;
  room: string;
  rooms: Set<string>;
  authSessionId: string | null;
  authProofType: 'access_token' | null;
  sessionValidatedAtMs: number;
  clientIp: string;
  messageWindowStart: number;
  messageCount: number;
}

type IncomingMessage = {
  type: string;
  data?: Record<string, unknown>;
};

type RealtimeSocketMessage = RealtimeChatMessage & {
  clientMessageId?: string;
};

type DistributedWsEvent = {
  v: 1;
  instanceId: string;
  type: 'new_message' | 'round_update' | 'board_update' | 'round_end' | 'new_deploy' | 'reaction_update';
  room?: string;
  data: unknown;
  emittedAtMs: number;
};

@Injectable()
export class WebSocketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebSocketService.name);
  private readonly authDebug = (process.env.AUTH_DEBUG ?? '').toLowerCase() === 'true';
  private wss: WebSocket.WebSocketServer;
  private clients = new Map<WebSocket, ClientMeta>();
  private heartbeatInterval: ReturnType<typeof setInterval>;
  private readonly wsInstanceId = randomUUID();
  private sessionRevalidateMs = 3000;
  private redisChannel = 'blitzmine:chat:events';
  private redisPub: Redis | null = null;
  private redisSub: Redis | null = null;
  private warnedRedisPubError = false;
  private warnedRedisSubError = false;
  private warnedRedisPubUnavailable = false;
  private warnedRedisSubUnavailable = false;
  private warnedRedisPublishFailed = false;
  private warnedWsEnvelopeSerialization = false;
  private warnedDistributedEnvelopeSerialization = false;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly chatService: ChatService,
    private readonly authService: AuthService,
    private readonly rateLimitService: RateLimitService,
    private readonly config: ConfigService,
  ) {
    const parsedRevalidate = Number(this.config.get<string>('WS_SESSION_REVALIDATE_MS') ?? '3000');
    if (Number.isFinite(parsedRevalidate) && parsedRevalidate > 0) {
      this.sessionRevalidateMs = parsedRevalidate;
    }
    const configuredChannel = (this.config.get<string>('WS_REDIS_CHANNEL') ?? '').trim();
    if (configuredChannel) {
      this.redisChannel = configuredChannel;
    }
  }

  onModuleInit() {
    this.initializeRedisBus();
    const server = this.httpAdapterHost.httpAdapter.getHttpServer();
    this.wss = new WebSocket.WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req: HttpIncomingMessage) => {
      const clientIp = this.resolveClientIp(req, ws);
      this.clients.set(ws, {
        wallet: null,
        alive: true,
        room: 'general',
        rooms: new Set(['general']),
        authSessionId: null,
        authProofType: null,
        sessionValidatedAtMs: 0,
        clientIp,
        messageWindowStart: Date.now(),
        messageCount: 0,
      });
      if (this.authDebug) {
        this.logger.log(`Client connected (total=${this.clients.size})`);
      }

      ws.on('pong', () => {
        const meta = this.clients.get(ws);
        if (meta) meta.alive = true;
      });

      ws.on('message', (raw: Buffer) => {
        this.handleMessage(ws, raw).catch((err) =>
          this.logger.error(`Message handling error: ${err.message}`),
        );
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        if (this.authDebug) {
          this.logger.log(`Client disconnected (total=${this.clients.size})`);
        }
      });

      ws.on('error', (err) => {
        this.logger.error(`WebSocket error: ${err.message}`);
        this.clients.delete(ws);
      });
    });

    // Heartbeat every 30s
    this.heartbeatInterval = setInterval(() => {
      for (const [ws, meta] of this.clients) {
        if (!meta.alive) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }
        meta.alive = false;
        ws.ping();
      }
    }, 30000);

    this.logger.log('WebSocket server started on /ws');
  }

  onModuleDestroy() {
    clearInterval(this.heartbeatInterval);
    for (const [ws] of this.clients) {
      ws.terminate();
    }
    if (this.redisPub) {
      void this.redisPub.quit().catch(() => this.redisPub?.disconnect());
      this.redisPub = null;
    }
    if (this.redisSub) {
      void this.redisSub.quit().catch(() => this.redisSub?.disconnect());
      this.redisSub = null;
    }
    this.wss?.close();
  }

  private isValidRoomName(room: string): boolean {
    return /^[a-zA-Z0-9_-]{1,32}$/.test(room);
  }

  private trustProxyEnabled(): boolean {
    const raw = (process.env.TRUST_PROXY ?? '').trim().toLowerCase();
    return raw !== '' && raw !== 'false' && raw !== '0' && raw !== 'off';
  }

  private parseForwardedIp(raw: string | string[] | undefined): string | null {
    if (!raw) return null;
    const value = Array.isArray(raw) ? raw[0] : raw;
    const first = value.split(',')[0]?.trim();
    return first ? first : null;
  }

  private resolveClientIp(req: HttpIncomingMessage, ws: WebSocket): string {
    if (this.trustProxyEnabled()) {
      const forwarded =
        this.parseForwardedIp(req.headers['x-forwarded-for']) ??
        this.parseForwardedIp(req.headers['x-real-ip']);
      if (forwarded) {
        return forwarded;
      }
    }

    const fromReq = req.socket?.remoteAddress;
    if (fromReq) {
      return fromReq;
    }

    const fromWs = (ws as unknown as { _socket?: { remoteAddress?: string } })._socket
      ?.remoteAddress;
    return fromWs ?? 'unknown';
  }

  private async handleMessage(ws: WebSocket, raw: Buffer) {
    if (raw.length > 4096) {
      this.send(ws, 'error', { code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' });
      return;
    }

    let msg: IncomingMessage;
    try {
      msg = JSON.parse(raw.toString()) as IncomingMessage;
    } catch {
      this.send(ws, 'error', { code: 'INVALID_JSON', message: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'ping':
        this.send(ws, 'pong', {});
        break;

      case 'authenticate': {
        const meta = this.clients.get(ws);
        const clientIp = meta?.clientIp ?? 'unknown';
        const data = msg.data ?? {};
        const accessToken = typeof data.accessToken === 'string' ? data.accessToken : null;
        if (this.authDebug) {
          this.logger.log('WS authenticate received');
        }

        try {
          await this.rateLimitService.assertRealtimeRateLimit(`ip:${clientIp}`, 'chat_auth', 80, 60_000, {
            code: 'RATE_LIMITED',
            message: 'Too many authentication attempts',
          });
        } catch {
          if (this.authDebug) {
            this.logger.warn('WS authenticate rate limited');
          }
          this.send(ws, 'auth_error', {
            code: 'RATE_LIMITED',
            message: 'Too many authentication attempts',
          });
          return;
        }

        if (!accessToken) {
          if (this.authDebug) {
            this.logger.warn('WS authenticate missing token');
          }
          this.clearClientAuth(ws);
          this.send(ws, 'auth_error', {
            code: 'MISSING_ACCESS_TOKEN',
            message: 'Missing access token',
          });
          return;
        }

        try {
          const claims = await this.authService.verifyAccessToken(accessToken);
          const meta = this.clients.get(ws);
          if (meta) {
            meta.wallet = claims.wallet;
            meta.authSessionId = claims.sessionId;
            meta.authProofType = 'access_token';
            meta.sessionValidatedAtMs = Date.now();
          }
          if (this.authDebug) {
            this.logger.log('WS authenticated');
          }
          this.send(ws, 'authenticated', { wallet: claims.wallet });
        } catch (err) {
          if (this.authDebug) {
            this.logger.warn('WS authenticate rejected');
          }
          this.clearClientAuth(ws);
          this.send(ws, 'auth_error', {
            code: 'INVALID_ACCESS_TOKEN',
            message: 'Invalid access token',
          });
        }
        break;
      }

      case 'send_message': {
        const meta = this.clients.get(ws);
        const data = msg.data ?? {};
        const clientMessageId = this.parseClientMessageId(data.clientMessageId);
        const receivedAtMs = Date.now();

        if (!meta?.wallet || !meta.authSessionId) {
          this.sendMessageError(ws, clientMessageId, 'NOT_AUTHENTICATED', 'Not authenticated');
          return;
        }

        const now = Date.now();
        if (now - meta.messageWindowStart > 10000) {
          meta.messageWindowStart = now;
          meta.messageCount = 0;
        }
        meta.messageCount += 1;
        if (meta.messageCount > 20) {
          this.sendMessageError(ws, clientMessageId, 'RATE_LIMITED', 'Rate limit exceeded');
          return;
        }

        const content = typeof data.content === 'string' ? data.content : '';
        const room = typeof data.room === 'string' ? data.room : null;
        const replyToId = typeof data.replyToId === 'string' ? data.replyToId : null;

        if (!content.trim()) {
          this.sendMessageError(ws, clientMessageId, 'MISSING_CONTENT', 'Missing content');
          return;
        }
        if (room && !this.isValidRoomName(room)) {
          this.sendMessageError(ws, clientMessageId, 'INVALID_ROOM', 'Invalid room name');
          return;
        }

        const targetRoom = room ?? meta.room;
        meta.rooms.add(targetRoom);
        // Validate reply target if provided
        let validatedReplyToId: string | null = null;
        if (replyToId) {
          try {
            validatedReplyToId = await this.chatService.validateReplyTo(replyToId, targetRoom);
          } catch (err) {
            if (err instanceof HttpException) {
              this.sendMessageError(ws, clientMessageId, 'INVALID_REPLY', err.message);
              return;
            }
            this.sendMessageError(ws, clientMessageId, 'INVALID_REPLY', 'Invalid reply target');
            return;
          }
        }

        let message: RealtimeChatMessage;
        try {
          message = this.chatService.buildRealtimeMessage({
            sender: meta.wallet,
            content,
            room: targetRoom,
            authSessionId: meta.authSessionId,
            authProofType: meta.authProofType,
            replyToId: validatedReplyToId,
          });
        } catch (err) {
          if (err instanceof HttpException) {
            const payload = err.getResponse();
            if (payload && typeof payload === 'object' && 'message' in payload) {
              const msg = Array.isArray(payload.message) ? payload.message[0] : String(payload.message);
              this.sendMessageError(ws, clientMessageId, 'INVALID_MESSAGE', msg);
              return;
            }
          }
          this.sendMessageError(ws, clientMessageId, 'SEND_FAILED', 'Unable to send message');
          return;
        }

        // Hydrate reply preview if this is a reply (async but fast — single DB lookup)
        const hydratedMessage = await this.chatService.hydrateReplyPreview(message);

        const emittedMessage: RealtimeSocketMessage = {
          ...hydratedMessage,
          clientMessageId,
        };

        // Event-first hot path: broadcast immediately after hydration.
        this.broadcastToRoom(targetRoom, 'new_message', emittedMessage);
        const broadcastAtMs = Date.now();
        this.send(ws, 'message_ack', { clientMessageId, message: emittedMessage });
        const ackAtMs = Date.now();

        if (this.authDebug) {
          this.logger.log(
            `WS send_message timing emit=${broadcastAtMs - receivedAtMs}ms ack=${ackAtMs - receivedAtMs}ms`,
          );
        }

        this.publishDistributedEvent({
          v: 1,
          instanceId: this.wsInstanceId,
          type: 'new_message',
          room: targetRoom,
          data: emittedMessage,
          emittedAtMs: broadcastAtMs,
        });

        void this.runPostSendChecks(ws, {
          wallet: meta.wallet,
          authSessionId: meta.authSessionId,
          clientIp: meta.clientIp,
          shouldRevalidateSession: receivedAtMs - meta.sessionValidatedAtMs > this.sessionRevalidateMs,
        });

        void this.chatService
          .persistRealtimeMessage(message, {
            sender: meta.wallet,
            content,
            room: targetRoom,
            authSessionId: meta.authSessionId,
            authProofType: meta.authProofType,
          })
          .then((persisted) => {
            if (this.authDebug) {
              this.logger.log(
                `WS send_message persistence=${persisted ? 'ok' : 'failed'} at ${
                  Date.now() - receivedAtMs
                }ms`,
              );
            }
          });
        break;
      }

      case 'join_room': {
        const meta = this.clients.get(ws);
        if (!meta) return;
        const joinRoom = typeof msg.data?.room === 'string' ? msg.data.room : null;

        if (joinRoom && this.isValidRoomName(joinRoom)) {
          meta.room = joinRoom;
          meta.rooms.add(joinRoom);
          this.send(ws, 'room_joined', { room: joinRoom, rooms: Array.from(meta.rooms) });
        } else if (joinRoom) {
          this.send(ws, 'error', { code: 'INVALID_ROOM', message: 'Invalid room name' });
        }
        break;
      }

      case 'toggle_reaction': {
        const reactionMeta = this.clients.get(ws);
        if (!reactionMeta?.wallet || !reactionMeta.authSessionId) {
          this.send(ws, 'error', { code: 'NOT_AUTHENTICATED', message: 'Not authenticated' });
          return;
        }

        const reactionData = msg.data ?? {};
        const messageId = typeof reactionData.messageId === 'string' ? reactionData.messageId : '';
        const emoji = typeof reactionData.emoji === 'string' ? reactionData.emoji : '';

        if (!messageId || !emoji) {
          this.send(ws, 'error', { code: 'INVALID_REACTION', message: 'Missing messageId or emoji' });
          return;
        }

        void (async () => {
          try {
            const result = await this.chatService.toggleReaction(messageId, emoji, reactionMeta.wallet!);
            // Broadcast to all clients in the reactor's current room
            this.broadcastToRoom(reactionMeta.room, 'reaction_update', {
              messageId: result.messageId,
              emoji: result.emoji,
              count: result.count,
              reactors: result.reactors,
              action: result.action,
              reactorWallet: reactionMeta.wallet,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Reaction failed';
            this.send(ws, 'error', { code: 'REACTION_FAILED', message });
          }
        })();
        break;
      }

      default:
        this.send(ws, 'error', { code: 'UNKNOWN_TYPE', message: `Unknown type: ${msg.type}` });
    }
  }

  private async runPostSendChecks(
    ws: WebSocket,
    context: {
      wallet: string;
      authSessionId: string;
      clientIp: string;
      shouldRevalidateSession: boolean;
    },
  ): Promise<void> {
    if (context.shouldRevalidateSession) {
      try {
        await this.authService.assertSessionActive(context.authSessionId, context.wallet);
        const meta = this.clients.get(ws);
        if (
          meta &&
          meta.wallet === context.wallet &&
          meta.authSessionId === context.authSessionId
        ) {
          meta.sessionValidatedAtMs = Date.now();
        }
      } catch {
        const meta = this.clients.get(ws);
        if (
          meta &&
          meta.wallet === context.wallet &&
          meta.authSessionId === context.authSessionId
        ) {
          this.clearClientAuth(ws);
          this.send(ws, 'auth_error', {
            code: 'SESSION_REVOKED',
            message: 'Session expired or revoked',
          });
        }
        return;
      }
    }

    try {
      await Promise.all([
        this.rateLimitService.assertRealtimeRateLimit(`wallet:${context.wallet}`, 'chat_send', 60, 10_000, {
          code: 'RATE_LIMITED',
          message: 'Rate limit exceeded',
        }),
        this.rateLimitService.assertRealtimeRateLimit(`ip:${context.clientIp}`, 'chat_send', 120, 10_000, {
          code: 'RATE_LIMITED',
          message: 'Rate limit exceeded',
        }),
      ]);
    } catch {
      const meta = this.clients.get(ws);
      if (
        meta &&
        meta.wallet === context.wallet &&
        meta.authSessionId === context.authSessionId
      ) {
        meta.messageWindowStart = Date.now();
        meta.messageCount = 21;
      }
      this.send(ws, 'error', {
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded',
      });
    }
  }

  private send(ws: WebSocket, type: string, data: unknown) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const payload = this.serializeWsEnvelope(type, data);
    if (!payload) return;
    ws.send(payload);
  }

  private sendMessageError(
    ws: WebSocket,
    clientMessageId: string | null,
    code: string,
    message: string,
  ) {
    this.send(ws, 'message_error', {
      clientMessageId,
      code,
      message,
    });
  }

  private clearClientAuth(ws: WebSocket) {
    const meta = this.clients.get(ws);
    if (!meta) return;
    meta.wallet = null;
    meta.authSessionId = null;
    meta.authProofType = null;
    meta.sessionValidatedAtMs = 0;
  }

  private parseClientMessageId(raw: unknown): string {
    if (typeof raw !== 'string') {
      return randomUUID();
    }
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 128) {
      return randomUUID();
    }
    return trimmed;
  }

  broadcast(type: string, data: unknown) {
    const payload = this.serializeWsEnvelope(type, data);
    if (!payload) return;
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  broadcastRoundUpdate(data: unknown) {
    this.broadcast('round_update', data);
    this.publishDistributedEvent({
      v: 1,
      instanceId: this.wsInstanceId,
      type: 'round_update',
      data,
      emittedAtMs: Date.now(),
    });
  }

  broadcastBoardUpdate(data: unknown) {
    this.broadcast('board_update', data);
    this.publishDistributedEvent({
      v: 1,
      instanceId: this.wsInstanceId,
      type: 'board_update',
      data,
      emittedAtMs: Date.now(),
    });
  }

  broadcastRoundEnd(data: unknown) {
    this.broadcast('round_end', data);
    this.publishDistributedEvent({
      v: 1,
      instanceId: this.wsInstanceId,
      type: 'round_end',
      data,
      emittedAtMs: Date.now(),
    });
  }

  broadcastNewDeploy(data: unknown) {
    this.broadcast('new_deploy', data);
    this.publishDistributedEvent({
      v: 1,
      instanceId: this.wsInstanceId,
      type: 'new_deploy',
      data,
      emittedAtMs: Date.now(),
    });
  }

  // broadcast to clients subscribed to a specific room
  broadcastToRoom(room: string, type: string, data: unknown): number {
    const payload = this.serializeWsEnvelope(type, data);
    if (!payload) return 0;
    let recipients = 0;
    for (const [ws, meta] of this.clients) {
      if (ws.readyState === WebSocket.OPEN && meta.rooms.has(room)) {
        ws.send(payload);
        recipients += 1;
      }
    }
    return recipients;
  }

  private initializeRedisBus() {
    const redisUrl = (this.config.get<string>('REDIS_URL') ?? '').trim();
    if (!redisUrl) {
      return;
    }

    const redisOptions = {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    } as const;

    this.redisPub = new Redis(redisUrl, redisOptions);
    this.redisSub = new Redis(redisUrl, redisOptions);

    this.redisPub.on('error', (err) => {
      if (this.warnedRedisPubError) return;
      this.warnedRedisPubError = true;
      this.logger.warn(`WS redis publisher error: ${err.message}`);
    });

    this.redisSub.on('error', (err) => {
      if (this.warnedRedisSubError) return;
      this.warnedRedisSubError = true;
      this.logger.warn(`WS redis subscriber error: ${err.message}`);
    });

    this.redisSub.on('message', (_channel, payload) => {
      this.handleDistributedMessage(payload);
    });

    void this.redisPub
      .connect()
      .then(() => {
        this.logger.log(`WS redis publisher connected (channel=${this.redisChannel})`);
      })
      .catch((err) => {
        if (this.warnedRedisPubUnavailable) return;
        this.warnedRedisPubUnavailable = true;
        this.logger.warn(`WS redis publisher unavailable: ${err.message}`);
      });

    void this.redisSub
      .connect()
      .then(async () => {
        if (!this.redisSub) return;
        await this.redisSub.subscribe(this.redisChannel);
        this.logger.log(`WS redis subscriber connected (channel=${this.redisChannel})`);
      })
      .catch((err) => {
        if (this.warnedRedisSubUnavailable) return;
        this.warnedRedisSubUnavailable = true;
        this.logger.warn(`WS redis subscriber unavailable: ${err.message}`);
      });
  }

  private publishDistributedEvent(event: DistributedWsEvent) {
    if (!this.redisPub) {
      return;
    }
    const payload = this.serializeDistributedEvent(event);
    if (!payload) return;
    void this.redisPub
      .publish(this.redisChannel, payload)
      .catch((err) => {
        if (this.warnedRedisPublishFailed) return;
        this.warnedRedisPublishFailed = true;
        this.logger.warn(`WS redis publish failed: ${err.message}`);
      });
  }

  private normalizePayload(value: unknown, seen = new WeakSet<object>()): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return { message: value.message };
    if (Array.isArray(value)) {
      return value.map((entry) => this.normalizePayload(entry, seen));
    }
    if (typeof value !== 'object') {
      return value;
    }
    if ('toBase58' in value && typeof (value as { toBase58?: () => string }).toBase58 === 'function') {
      return (value as { toBase58: () => string }).toBase58();
    }
    if (seen.has(value)) {
      return null;
    }
    seen.add(value);
    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      normalized[key] = this.normalizePayload(entry, seen);
    }
    return normalized;
  }

  private serializeWsEnvelope(type: string, data: unknown): string | null {
    try {
      return JSON.stringify({
        type,
        data: this.normalizePayload(data),
      });
    } catch (err) {
      if (!this.warnedWsEnvelopeSerialization) {
        this.warnedWsEnvelopeSerialization = true;
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`WS payload serialization failed: ${message}`);
      }
      return null;
    }
  }

  private serializeDistributedEvent(event: DistributedWsEvent): string | null {
    try {
      return JSON.stringify({
        ...event,
        data: this.normalizePayload(event.data),
      });
    } catch (err) {
      if (!this.warnedDistributedEnvelopeSerialization) {
        this.warnedDistributedEnvelopeSerialization = true;
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`WS distributed payload serialization failed: ${message}`);
      }
      return null;
    }
  }

  private handleDistributedMessage(payload: string) {
    let event: DistributedWsEvent | null = null;
    try {
      event = JSON.parse(payload) as DistributedWsEvent;
    } catch {
      return;
    }
    if (!event || event.v !== 1) {
      return;
    }
    if (event.instanceId === this.wsInstanceId) {
      return;
    }

    if (event.type === 'reaction_update') {
      if (event.room) {
        this.broadcastToRoom(event.room, 'reaction_update', event.data);
      }
      return;
    }

    if (event.type === 'new_message') {
      if (!event.room) return;
      this.broadcastToRoom(event.room, 'new_message', event.data);
      return;
    }

    if (event.type === 'round_update' || event.type === 'board_update' || event.type === 'round_end' || event.type === 'new_deploy') {
      this.broadcast(event.type, event.data);
    }
  }
}
