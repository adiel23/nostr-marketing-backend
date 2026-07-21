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

export interface GeneratePromotionalCommentInput {
  postContent: string;
  campaignName: string;
  productDescription: string;
  promotionalComment: string;
  foundKeywords: string[];
}

export interface GeneratePromotionalCommentResult {
  content: string;
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

      const content = result?.choices?.[0]?.message?.content ?? '{}';
      return this.parseResult(content);
    } catch (error) {
      this.logger.error('Error al consultar OpenRouter', error);
      return {
        match: false,
        reason: 'No se pudo interpretar la respuesta del modelo',
        confidence: 0,
      };
    }
  }

  async generatePromotionalComment(
    input: GeneratePromotionalCommentInput,
  ): Promise<GeneratePromotionalCommentResult | null> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat';

    if (!apiKey) {
      this.logger.warn(
        'OPENROUTER_API_KEY no configurada. Usando comentario fijo.',
      );
      return null;
    }

    const prompt = `
Eres un redactor de comentarios promocionales para Nostr.

Escribe un comentario breve, natural y útil como respuesta al post del usuario.
Debe promocionar la campaña sin sonar agresivo ni engañoso.
Usa el comentario base como guía de tono/oferta y adapta el texto al contexto del post.
No inventes beneficios que no estén en la descripción del producto.
Devuelve SOLO el texto final del comentario, sin comillas ni markdown.

Post del usuario:
${input.postContent}

Nombre de la campaña:
${input.campaignName}

Descripción del producto:
${input.productDescription}

Comentario base:
${input.promotionalComment}

Keywords encontradas:
${input.foundKeywords.join(', ')}
`;

    const client = new OpenRouter({
      apiKey,
      httpReferer: 'http://localhost:3000',
      appTitle: 'nostr-marketing-backend',
    });

    try {
      const result = await client.chat.send({
        chatRequest: {
          model,
          messages: [
            {
              role: 'system',
              content:
                'Responde únicamente con el comentario promocional final.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
        },
      });

      const content = result?.choices?.[0]?.message?.content?.trim();
      if (!content) return null;

      const cleaned = content.replace(/^["']|["']$/g, '').trim();
      if (!cleaned) return null;

      return { content: cleaned };
    } catch (error) {
      this.logger.error('Error al generar comentario promocional', error);
      return null;
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
      const parsed = JSON.parse(jsonText);

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error('Model response did not produce a JSON object');
      }

      return {
        match: Boolean(parsed.match),
        reason: String(parsed.reason ?? 'Sin explicación'),
        confidence: Number(parsed.confidence ?? 0),
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
}
