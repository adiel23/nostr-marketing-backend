import { Injectable, Logger } from '@nestjs/common';
import { finalizeEvent } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import { getPlatformSecretKey, getRelayUrl } from './nostr-keys.util';

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

  async publishComment(input: PublishCommentInput): Promise<PublishCommentResult> {
    const relayUrl = getRelayUrl();
    const secretKey = getPlatformSecretKey();
    const signedEvent = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', input.targetEventId, relayUrl, 'root'],
          ['e', input.targetEventId, relayUrl, 'reply'],
          ['p', input.targetPubkey],
        ],
        content: input.content,
      },
      secretKey,
    );

    const pool = new SimplePool();
    try {
      await pool.publish([relayUrl], signedEvent);
      this.logger.log(`Comentario promocional publicado: ${signedEvent.id}`);
      return { eventId: signedEvent.id };
    } finally {
      pool.close([relayUrl]);
    }
  }
}
