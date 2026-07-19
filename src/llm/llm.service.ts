import { Injectable, Logger } from '@nestjs/common';
import { OpenRouter } from '@openrouter/sdk';
import { isRecord } from 'src/common/type-guards.util';

export interface EvaluateIntentInput {
  postContent: string;
  campaignName: string;
  productDescription: string;
}

export interface EvaluateIntentResult {
  match: boolean;
  reason: string;
  confidence: number;
}

const MINIMUM_MATCH_CONFIDENCE = 0.8;
const LLM_REQUEST_TIMEOUT_MS = 15_000;

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  async evaluateIntent(
    input: EvaluateIntentInput,
  ): Promise<EvaluateIntentResult> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat';

    if (!apiKey) {
      this.logger.warn(
        'OPENROUTER_API_KEY no configurada. Retornando fallback sin match.',
      );
      return {
        match: false,
        reason: 'No OpenRouter API key configured',
        confidence: 0,
      };
    }

    const prompt = `
Eres un clasificador de intención comercial para publicidad en Nostr.

Tu tarea es decidir si el usuario que escribió el post está mostrando un interés en un producto o servicio relacionado con lo que la empresa está promocionando en la campaña o si el producto o servicio que ofrece la empresa podría resolver el/los problema/s que el usuario está describiendo.

Devuelve SOLO un JSON con este formato:
{
  "match": true o false,
  "reason": "explicación breve de por qué es un match o no",
  "confidence": un número entre 0 y 1 que indique la confianza de tu decisión
}

Post del usuario:
${input.postContent}

Nombre de la campaña:
${input.campaignName}

Descripción del producto:
${input.productDescription}
`;

    const client = new OpenRouter({
      apiKey,
      httpReferer: 'http://localhost:3000', // Optional. Site URL for rankings on openrouter.ai.
      appTitle: 'nostr-marketing-backend', // Optional. Site title for rankings on openrouter.ai.
    });

    let result: unknown;
    try {
      result = await client.chat.send(
        {
          chatRequest: {
            model,
            stream: false,
            messages: [
              {
                role: 'system',
                content: 'Responde únicamente con JSON válido.',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
          },
        },
        { timeoutMs: LLM_REQUEST_TIMEOUT_MS },
      );
    } catch (error) {
      // Fallo de red/timeout/infra: es transitorio, no una senal de "sin
      // interes". Se relanza para que BullMQ reintente el trabajo en vez
      // de descartar el match silenciosamente.
      this.logger.error(
        'Error al consultar OpenRouter; se reintentara el trabajo.',
        error,
      );
      throw error;
    }

    const completion = result as ChatCompletionResponse;
    const content = completion.choices?.[0]?.message?.content;
    return this.parseResult(typeof content === 'string' ? content : '{}');
  }

  private parseResult(content: string): EvaluateIntentResult {
    try {
      const cleaned = content
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');

      if (start < 0 || end <= start) {
        throw new Error('No JSON object found in model response');
      }

      const jsonText = cleaned.slice(start, end + 1);
      const parsed: unknown = JSON.parse(jsonText);

      if (!isRecord(parsed)) {
        throw new Error('Model response did not produce a JSON object');
      }

      const confidence = this.getConfidence(parsed.confidence);

      return {
        match: parsed.match === true && confidence >= MINIMUM_MATCH_CONFIDENCE,
        reason:
          typeof parsed.reason === 'string' ? parsed.reason : 'Sin explicación',
        confidence,
      };
    } catch (error) {
      this.logger.warn(
        'Respuesta del modelo sin JSON válido. Usando fallback.',
        error,
      );
      return {
        match: false,
        reason: 'No se pudo interpretar la respuesta del modelo',
        confidence: 0,
      };
    }
  }

  private getConfidence(value: unknown): number {
    return typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1
      ? value
      : 0;
  }
}
