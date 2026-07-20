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
            content: '{"match": true, "reason": "El usuario busca una wallet Bitcoin segura", "confidence": 0.92}',
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

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatRequest: expect.objectContaining({
          model: 'test-model',
          messages: expect.any(Array),
        }),
      }),
    );
    expect(result.match).toBe(true);
    expect(result.reason).toContain('wallet Bitcoin');
    expect(result.confidence).toBeGreaterThan(0.9);
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
});
