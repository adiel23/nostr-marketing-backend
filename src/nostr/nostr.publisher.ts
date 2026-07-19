import { Injectable, Logger } from '@nestjs/common';
import { finalizeEvent } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import {
  getPlatformSecretKey,
  getPublishRelayUrl,
  getRelayUrl,
} from './nostr-keys.util';

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
    const sourceRelayUrl = getRelayUrl();
    const publishRelayUrl = getPublishRelayUrl();
    const secretKey = getPlatformSecretKey();
    const signedEvent = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', input.targetEventId, sourceRelayUrl, 'root'],
          ['e', input.targetEventId, sourceRelayUrl, 'reply'],
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
