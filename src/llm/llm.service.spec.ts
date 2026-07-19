import { Test, TestingModule } from '@nestjs/testing';
import { OpenRouter } from '@openrouter/sdk';
import { LlmService } from './llm.service';

jest.mock('@openrouter/sdk', () => ({
  OpenRouter: jest.fn(),
}));

describe('LlmService', () => {
  let service: LlmService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [LlmService],
    }).compile();

    service = module.get<LlmService>(LlmService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should parse a JSON decision from the SDK response', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_MODEL = 'test-model';

    const sendMock = jest.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content:
              '{"match": true, "reason": "El usuario busca una wallet Bitcoin segura", "confidence": 0.92}',
          },
        },
      ],
    });

    (OpenRouter as jest.Mock).mockImplementation(() => ({
      chat: { send: sendMock },
    }));

    const result = await service.evaluateIntent({
      postContent: 'Estoy buscando una wallet Bitcoin segura',
      campaignName: 'Wallet Bitcoin',
      productDescription: 'Wallet Bitcoin segura para almacenar sats',
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const calls = sendMock.mock.calls as unknown as Array<
      [
        {
          chatRequest: { model: string; messages: unknown[] };
        },
      ]
    >;
    const request = calls[0]?.[0];
    expect(request).toBeDefined();
    if (!request) {
      throw new Error('Expected OpenRouter request');
    }
    expect(request.chatRequest.model).toBe('test-model');
    expect(request.chatRequest.messages).toHaveLength(2);
    expect(result.match).toBe(true);
    expect(result.reason).toContain('wallet Bitcoin');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('propagates transient network/timeout failures instead of hiding them as no-match', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';

    const sendMock = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    (OpenRouter as jest.Mock).mockImplementation(() => ({
      chat: { send: sendMock },
    }));

    await expect(
      service.evaluateIntent({
        postContent: 'hola',
        campaignName: 'campaña',
        productDescription: 'producto',
      }),
    ).rejects.toThrow('ETIMEDOUT');
  });

  it('bounds the OpenRouter request with a timeout', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';

    const sendMock = jest.fn().mockResolvedValue({
      choices: [{ message: { content: '{"match":false,"confidence":0}' } }],
    });
    (OpenRouter as jest.Mock).mockImplementation(() => ({
      chat: { send: sendMock },
    }));

    await service.evaluateIntent({
      postContent: 'hola',
      campaignName: 'campaña',
      productDescription: 'producto',
    });

    const calls = sendMock.mock.calls as unknown as Array<
      [unknown, { timeoutMs?: number }]
    >;
    expect(calls[0]?.[1]?.timeoutMs).toBeGreaterThan(0);
  });

  it('should return a safe fallback when the SDK response is empty or invalid', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';

    const sendMock = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'not-json' } }],
    });

    (OpenRouter as jest.Mock).mockImplementation(() => ({
      chat: { send: sendMock },
    }));

    const result = await service.evaluateIntent({
      postContent: 'hola',
      campaignName: 'campaña',
      productDescription: 'producto',
    });

    expect(result.match).toBe(false);
    expect(result.reason).toContain('No se pudo interpretar');
    expect(result.confidence).toBe(0);
  });

  it('requires a boolean match and a confidence at or above the safety threshold', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';

    const sendMock = jest
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content:
                '{"match":"true", "reason":"string truthy", "confidence":0.99}',
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content:
                '{"match":true, "reason":"low confidence", "confidence":0.79}',
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content:
                '{"match":true, "reason":"invalid confidence", "confidence":1.2}',
            },
          },
        ],
      });

    (OpenRouter as jest.Mock).mockImplementation(() => ({
      chat: { send: sendMock },
    }));

    const input = {
      postContent: 'hola',
      campaignName: 'campaÃ±a',
      productDescription: 'producto',
    };

    await expect(service.evaluateIntent(input)).resolves.toMatchObject({
      match: false,
      confidence: 0.99,
    });
    await expect(service.evaluateIntent(input)).resolves.toMatchObject({
      match: false,
      confidence: 0.79,
    });
    await expect(service.evaluateIntent(input)).resolves.toMatchObject({
      match: false,
      confidence: 0,
    });
  });
});
