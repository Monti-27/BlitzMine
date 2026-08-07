import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { validateAndSanitizeChatContent } from './utils/message-validation';

interface SendMessageInput {
  sender: string;
  content: string;
  room?: string;
  signature?: string;
  authSessionId?: string | null;
  authProofType?: string | null;
  replyToId?: string | null;
}

export interface ReactionToggleResult {
  action: 'added' | 'removed';
  messageId: string;
  emoji: string;
  count: number;
  reactors: string[];
}

export interface RealtimeChatMessage {
  id: string;
  sender: string;
  content: string;
  room: string;
  createdAt: string;
  clientMessageId?: string;
  replyToId?: string | null;
  replyTo?: {
    id: string;
    sender: string;
    contentPreview: string;
  } | null;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private readonly db: DatabaseService) {}

  buildRealtimeMessage(input: SendMessageInput): RealtimeChatMessage {
    const room = input.room ?? 'general';
    const content = validateAndSanitizeChatContent(input.content, {
      maxGraphemes: 500,
      maxBytes: 2_000,
    });
    const createdAt = new Date().toISOString();

    return {
      id: randomUUID(),
      sender: input.sender,
      content,
      room,
      createdAt,
      replyToId: input.replyToId ?? null,
    };
  }

  /** Hydrate a realtime message with reply preview data from DB. */
  async hydrateReplyPreview(message: RealtimeChatMessage): Promise<RealtimeChatMessage> {
    if (!message.replyToId) return message;

    const target = await this.db.chatMessage.findUnique({
      where: { id: message.replyToId },
      select: { id: true, sender: true, content: true, deleted: true },
    });

    if (!target || target.deleted) {
      return {
        ...message,
        replyTo: {
          id: message.replyToId,
          sender: '',
          contentPreview: 'Original message unavailable',
        },
      };
    }

    return {
      ...message,
      replyTo: {
        id: target.id,
        sender: target.sender,
        contentPreview: target.content.slice(0, 80),
      },
    };
  }

  persistRealtimeMessage(message: RealtimeChatMessage, input: SendMessageInput): Promise<boolean> {
    return this.persistWithRetry(message, input);
  }

  async sendMessage(input: SendMessageInput) {
    const realtimeMessage = this.buildRealtimeMessage(input);
    return this.persistMessageRecord(realtimeMessage, input);
  }

  async getMessages(room: string = 'general', limit: number = 50, before?: Date) {
    const messages = await this.db.chatMessage.findMany({
      where: {
        room,
        deleted: false,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      select: {
        id: true,
        sender: true,
        content: true,
        room: true,
        createdAt: true,
        replyToId: true,
        replyTo: {
          select: {
            id: true,
            sender: true,
            content: true,
            deleted: true,
          },
        },
        reactions: {
          select: {
            emoji: true,
            reactorWallet: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return messages.map((msg) => ({
      ...msg,
      replyTo: msg.replyTo
        ? {
            id: msg.replyTo.id,
            sender: msg.replyTo.sender,
            contentPreview: msg.replyTo.deleted
              ? 'Original message unavailable'
              : msg.replyTo.content.slice(0, 80),
          }
        : null,
      reactions: this.aggregateReactions(msg.reactions),
    }));
  }

  async getMessageCount(room: string = 'general') {
    return this.db.chatMessage.count({ where: { room } });
  }

  parseBeforeCursor(raw?: string): Date | undefined {
    if (!raw) return undefined;

    const asInt = Number.parseInt(raw, 10);
    if (Number.isFinite(asInt) && String(asInt) === raw.trim()) {
      const ms = asInt > 1_000_000_000_000 ? asInt : asInt * 1000;
      const fromEpoch = new Date(ms);
      if (Number.isNaN(fromEpoch.getTime())) {
        throw new BadRequestException('Invalid before timestamp');
      }
      return fromEpoch;
    }

    const fromIso = new Date(raw);
    if (Number.isNaN(fromIso.getTime())) {
      throw new BadRequestException('Invalid before timestamp');
    }

    return fromIso;
  }

  private async persistMessageRecord(
    message: RealtimeChatMessage,
    input: SendMessageInput,
  ) {
    const proofType = input.authProofType ?? 'legacy_signature';
    const signature = input.signature ?? (input.authSessionId ? `session:${input.authSessionId}` : 'legacy');
    const data = {
      id: message.id,
      createdAt: new Date(message.createdAt),
      sender: message.sender,
      username: null,
      content: message.content,
      signature,
      avatarUrlSnapshot: null,
      room: message.room,
      authSessionId: input.authSessionId,
      authProofType: proofType,
      replyToId: input.replyToId ?? null,
    };

    try {
      return await this.db.chatMessage.create({ data });
    } catch (err) {
      if (!this.isForeignKeyConstraintError(err)) {
        throw err;
      }

      // First-time wallets might not have a miner row yet; bootstrap once and retry.
      await this.db.miner.upsert({
        where: { wallet: input.sender },
        create: { wallet: input.sender },
        update: {},
      });

      return this.db.chatMessage.create({ data });
    }
  }

  private async persistWithRetry(
    message: RealtimeChatMessage,
    input: SendMessageInput,
  ): Promise<boolean> {
    const maxAttempts = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.persistMessageRecord(message, input);
        return true;
      } catch (err) {
        lastError = err as Error;
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 100));
        }
      }
    }

    this.logger.error(
      `Failed to persist chat message ${message.id} after ${maxAttempts} attempts: ${lastError?.message ?? 'unknown error'}`,
    );
    return false;
  }

  private isForeignKeyConstraintError(err: unknown): err is Prisma.PrismaClientKnownRequestError {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      return err.code === 'P2003';
    }
    if (err && typeof err === 'object' && 'code' in err) {
      return (err as { code?: unknown }).code === 'P2003';
    }
    return false;
  }

  // ── Reactions ──

  async toggleReaction(
    messageId: string,
    emoji: string,
    reactorWallet: string,
  ): Promise<ReactionToggleResult> {
    // Validate emoji (single grapheme, max 8 bytes to prevent abuse)
    if (!emoji || Buffer.byteLength(emoji, 'utf8') > 8) {
      throw new BadRequestException('Invalid emoji');
    }

    // Check message exists and is not deleted
    const message = await this.db.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, deleted: true, room: true },
    });
    if (!message || message.deleted) {
      throw new BadRequestException('Message not found');
    }

    // Toggle: try delete first, if nothing deleted then insert
    const deleted = await this.db.chatReaction.deleteMany({
      where: { messageId, emoji, reactorWallet },
    });

    let action: 'added' | 'removed';
    if (deleted.count > 0) {
      action = 'removed';
    } else {
      try {
        await this.db.chatReaction.create({
          data: { messageId, emoji, reactorWallet },
        });
        action = 'added';
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // Race condition: already exists, treat as remove
          await this.db.chatReaction.deleteMany({
            where: { messageId, emoji, reactorWallet },
          });
          action = 'removed';
        } else {
          throw err;
        }
      }
    }

    // Get updated reaction state for this emoji on this message
    const reactions = await this.db.chatReaction.findMany({
      where: { messageId, emoji },
      select: { reactorWallet: true },
    });

    return {
      action,
      messageId,
      emoji,
      count: reactions.length,
      reactors: reactions.map((r) => r.reactorWallet),
    };
  }

  // ── Reply validation ──

  async validateReplyTo(
    replyToId: string | null | undefined,
    room: string,
  ): Promise<string | null> {
    if (!replyToId) return null;

    const target = await this.db.chatMessage.findUnique({
      where: { id: replyToId },
      select: { id: true, room: true, deleted: true, replyToId: true },
    });

    if (!target || target.deleted) {
      throw new BadRequestException('Reply target message not found');
    }
    if (target.room !== room) {
      throw new BadRequestException('Cannot reply to a message in a different room');
    }
    if (target.replyToId) {
      throw new BadRequestException('Cannot reply to a reply');
    }

    return target.id;
  }

  // ── Reaction aggregation helper ──

  private aggregateReactions(
    reactions: Array<{ emoji: string; reactorWallet: string }> = [],
  ): Array<{ emoji: string; count: number; reactors: string[] }> {
    const map = new Map<string, string[]>();
    for (const r of reactions) {
      const list = map.get(r.emoji) ?? [];
      list.push(r.reactorWallet);
      map.set(r.emoji, list);
    }
    return Array.from(map.entries()).map(([emoji, reactors]) => ({
      emoji,
      count: reactors.length,
      reactors,
    }));
  }
}
