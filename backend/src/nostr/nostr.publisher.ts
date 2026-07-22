import { Injectable, Logger } from '@nestjs/common';
import { finalizeEvent, type Event } from 'nostr-tools/pure';
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

  prepareComment(input: PublishCommentInput): Event {
    const relayUrl = getRelayUrl();
    const secretKey = getPlatformSecretKey();
    return finalizeEvent(
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
  }

  async publishPreparedComment(
    signedEvent: Event,
  ): Promise<PublishCommentResult> {
    const relayUrl = getRelayUrl();

    const pool = new SimplePool();
    try {
      await Promise.all(pool.publish([relayUrl], signedEvent));
      this.logger.log(`Comentario promocional publicado: ${signedEvent.id}`);
      return { eventId: signedEvent.id };
    } finally {
      pool.close([relayUrl]);
    }
  }

  async publishComment(
    input: PublishCommentInput,
  ): Promise<PublishCommentResult> {
    return this.publishPreparedComment(this.prepareComment(input));
  }
}
