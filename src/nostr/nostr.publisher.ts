import { Injectable, Logger } from '@nestjs/common';
import { finalizeEvent } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import { getPlatformSecretKey, getPublishRelayUrl } from './nostr-keys.util';
import { NOSTR_KIND_TEXT_NOTE } from './nostr.constants';

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
    const signedEvent = finalizeEvent(
      {
        kind: NOSTR_KIND_TEXT_NOTE,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          // El hint de relay en las tags publicas debe ser un relay
          // publicamente alcanzable: nunca el relay de escucha interno,
          // que puede ser privado o un relay de pruebas aislado.
          ['e', input.targetEventId, publishRelayUrl, 'root'],
          ['e', input.targetEventId, publishRelayUrl, 'reply'],
          ['p', input.targetPubkey],
        ],
        content: input.content,
      },
      secretKey,
    );

    const pool = new SimplePool();
    try {
      await Promise.all(pool.publish([publishRelayUrl], signedEvent));
      this.logger.log(`Comentario promocional publicado: ${signedEvent.id}`);
      return { eventId: signedEvent.id };
    } finally {
      pool.close([publishRelayUrl]);
    }
  }
}
