import { WebSocketService } from './websocket.service';

describe('WebSocketService', () => {
  function createService() {
    const httpAdapterHost = {
      httpAdapter: {
        getHttpServer: jest.fn().mockReturnValue({}),
      },
    };
    const chatService = {};
    const authService = {};
    const rateLimitService = {};
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    };

    return new WebSocketService(
      httpAdapterHost as never,
      chatService as never,
      authService as never,
      rateLimitService as never,
      config as never,
    );
  }

  it('normalizes bigint/date payloads before serialization', () => {
    const service = createService();
    const serialized = (service as unknown as { serializeWsEnvelope: (type: string, data: unknown) => string | null })
      .serializeWsEnvelope('round_update', {
        totalDeployedLamports: 42n,
        emittedAt: new Date('2026-02-23T12:00:00.000Z'),
      });

    expect(serialized).not.toBeNull();
    expect(serialized).toContain('"totalDeployedLamports":"42"');
    expect(serialized).toContain('"emittedAt":"2026-02-23T12:00:00.000Z"');
  });
});

