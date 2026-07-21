import { Injectable, Logger } from '@nestjs/common';
import { finalizeEvent, verifyEvent, type Event } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import {
  getPlatformPublicKey,
  getPlatformSecretKey,
  getPublishRelayUrl,
} from './nostr-keys.util';
import { NOSTR_KIND_TEXT_NOTE } from './nostr.constants';

const COMMENT_PUBLISH_ATTEMPTS = 3;
const COMMENT_RETRY_DELAY_MS = 750;
const COMMENT_VERIFICATION_MAX_WAIT_MS = 5_000;

export interface PublishCommentInput {
  targetEventId: string;
  targetPubkey: string;
  content: string;
}

export interface PublishCommentResult {
  eventId: string;
}

@Injectable()
export class NostrPublisher {
  private readonly logger = new Logger(NostrPublisher.name);

  async publishComment(
    input: PublishCommentInput,
  ): Promise<PublishCommentResult> {
    const publishRelayUrl = getPublishRelayUrl();
    const secretKey = getPlatformSecretKey();
    const platformPubkey = getPlatformPublicKey();
    const signedEvent = finalizeEvent(
      {
        kind: NOSTR_KIND_TEXT_NOTE,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          // El hint de relay en las tags publicas debe ser un relay
          // publicamente alcanzable: nunca el relay de escucha interno,
          // que puede ser privado o un relay de pruebas aislado.
          // Una respuesta directa a la nota raiz solo lleva el marcador
          // `root` segun NIP-10. Agregar tambien `reply` para el mismo
          // evento crea una cadena ambigua que algunos clientes moviles no
          // clasifican como respuesta notificable.
          ['e', input.targetEventId, publishRelayUrl, 'root'],
          ['p', input.targetPubkey],
        ],
        content: input.content,
      },
      secretKey,
    );

    for (let attempt = 1; attempt <= COMMENT_PUBLISH_ATTEMPTS; attempt++) {
      const pool = new SimplePool();
      try {
        await Promise.all(pool.publish([publishRelayUrl], signedEvent));
        const publishedEvent = await pool.get(
          [publishRelayUrl],
          { ids: [signedEvent.id], limit: 1 },
          { maxWait: COMMENT_VERIFICATION_MAX_WAIT_MS },
        );

        if (
          this.isConfirmedComment(
            publishedEvent,
            signedEvent.id,
            platformPubkey,
            input,
          )
        ) {
          this.logger.log(
            `Comentario promocional publicado y confirmado: ${signedEvent.id}`,
          );
          return { eventId: signedEvent.id };
        }

        this.logger.warn(
          `El relay no confirmó el comentario ${signedEvent.id} (intento ${attempt}/${COMMENT_PUBLISH_ATTEMPTS}).`,
        );
      } catch {
        this.logger.warn(
          `No se pudo publicar o confirmar el comentario ${signedEvent.id} (intento ${attempt}/${COMMENT_PUBLISH_ATTEMPTS}).`,
        );
      } finally {
        pool.close([publishRelayUrl]);
      }

      if (attempt < COMMENT_PUBLISH_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, COMMENT_RETRY_DELAY_MS * attempt),
        );
      }
    }

    throw new Error(
      'El comentario promocional no pudo confirmarse en el relay; el zap no se enviará.',
    );
  }

  private isConfirmedComment(
    event: Event | null,
    eventId: string,
    platformPubkey: string,
    input: PublishCommentInput,
  ): boolean {
    if (
      !event ||
      event.id !== eventId ||
      event.kind !== NOSTR_KIND_TEXT_NOTE ||
      event.pubkey !== platformPubkey ||
      event.content !== input.content ||
      !verifyEvent(event)
    ) {
      return false;
    }

    return (
      event.tags.some(
        (tag) =>
          tag[0] === 'e' && tag[1] === input.targetEventId && tag[3] === 'root',
      ) &&
      event.tags.some((tag) => tag[0] === 'p' && tag[1] === input.targetPubkey)
    );
  }
}
