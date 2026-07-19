import { Injectable, Logger } from '@nestjs/common';
import { OpenRouter } from '@openrouter/sdk';

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

    try {
      const result = await client.chat.send({
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
      });

      const completion = result as unknown as ChatCompletionResponse;
      const content = completion.choices?.[0]?.message?.content;
      return this.parseResult(typeof content === 'string' ? content : '{}');
    } catch (error) {
      this.logger.error('Error al consultar OpenRouter', error);
      return {
        match: false,
        reason: 'No se pudo interpretar la respuesta del modelo',
        confidence: 0,
      };
    }
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

      if (!this.isRecord(parsed)) {
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
