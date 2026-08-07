import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { DatabaseService } from '../database/database.service';

const mockDb = {
  chatMessage: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  miner: {
    upsert: jest.fn(),
  },
};

describe('ChatService', () => {
  let service: ChatService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDb.miner.upsert.mockResolvedValue({ wallet: 'walletABC' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: DatabaseService, useValue: mockDb },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  describe('sendMessage', () => {
    it('should create a message in the database with auth metadata', async () => {
      const mockMessage = {
        id: 'msg-1',
        sender: 'walletABC',
        content: 'Hello world',
        signature: 'session:sid-1',
        room: 'general',
        authSessionId: 'sid-1',
        authProofType: 'access_token',
      };
      mockDb.chatMessage.create.mockResolvedValue(mockMessage);

      const result = await service.sendMessage({
        sender: 'walletABC',
        content: 'Hello world',
        authSessionId: 'sid-1',
        authProofType: 'access_token',
      });

      expect(result).toEqual(mockMessage);
      expect(mockDb.chatMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sender: 'walletABC',
          username: null,
          content: 'Hello world',
          signature: 'session:sid-1',
          avatarUrlSnapshot: null,
          room: 'general',
          authSessionId: 'sid-1',
          authProofType: 'access_token',
        }),
      });
    });

    it('bootstraps miner row once on foreign-key failure and retries', async () => {
      const fkErr = Object.assign(new Error('fk'), { code: 'P2003' });
      const saved = {
        id: 'msg-2',
        sender: 'walletABC',
        content: 'first message',
        signature: 'legacy',
        room: 'general',
        authSessionId: null,
        authProofType: 'legacy_signature',
      };
      mockDb.chatMessage.create
        .mockRejectedValueOnce(fkErr)
        .mockResolvedValueOnce(saved);

      const result = await service.sendMessage({
        sender: 'walletABC',
        content: 'first message',
      });

      expect(mockDb.miner.upsert).toHaveBeenCalledWith({
        where: { wallet: 'walletABC' },
        create: { wallet: 'walletABC' },
        update: {},
      });
      expect(mockDb.chatMessage.create).toHaveBeenCalledTimes(2);
      expect(result).toEqual(saved);
    });

    it('rejects empty/invalid content after sanitization', async () => {
      await expect(
        service.sendMessage({
          sender: 'walletABC',
          content: '\u0000\u0007   ',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getMessages', () => {
    it('should return messages with correct ordering and limit', async () => {
      const mockMessages = [
        { id: 3, content: 'msg3', room: 'general' },
        { id: 2, content: 'msg2', room: 'general' },
      ];
      mockDb.chatMessage.findMany.mockResolvedValue(mockMessages);

      const result = await service.getMessages('general', 50);

      expect(result).toEqual(
        mockMessages.map((message) => ({
          ...message,
          reactions: [],
          replyTo: null,
        })),
      );
      expect(mockDb.chatMessage.findMany).toHaveBeenCalledWith({
        where: { room: 'general', deleted: false },
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
        take: 50,
      });
    });
  });

  describe('getMessageCount', () => {
    it('should return the message count for the specified room', async () => {
      mockDb.chatMessage.count.mockResolvedValue(42);

      const result = await service.getMessageCount('general');

      expect(result).toBe(42);
      expect(mockDb.chatMessage.count).toHaveBeenCalledWith({
        where: { room: 'general' },
      });
    });
  });

  describe('parseBeforeCursor', () => {
    it('should parse unix-second timestamp strings', () => {
      const date = service.parseBeforeCursor('1700000000');
      expect(date?.getTime()).toBe(1700000000 * 1000);
    });

    it('should throw for invalid timestamps', () => {
      expect(() => service.parseBeforeCursor('bad-date')).toThrow(BadRequestException);
    });
  });
});
