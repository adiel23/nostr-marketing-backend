jest.mock('nostr-tools/pure', () => ({
  finalizeEvent: jest.fn(() => ({ id: 'comment-id' })),
}));

const publish = jest.fn(() => [Promise.resolve()]);
const close = jest.fn();

jest.mock('nostr-tools/pool', () => ({
  SimplePool: jest.fn().mockImplementation(() => ({ publish, close })),
}));

jest.mock('./nostr-keys.util', () => ({
  getPlatformSecretKey: jest.fn(() => new Uint8Array(32)),
  getRelayUrl: jest.fn(() => 'wss://source.example'),
  getPublishRelayUrl: jest.fn(() => 'wss://public.example'),
}));

import { finalizeEvent } from 'nostr-tools/pure';
import { NostrPublisher } from './nostr.publisher';

describe('NostrPublisher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    publish.mockReturnValue([Promise.resolve()]);
  });

  it('publishes promotional replies to the configured public relay', async () => {
    const result = await new NostrPublisher().publishComment({
      targetEventId: 'target-event',
      targetPubkey: 'target-pubkey',
      content: 'Oferta de prueba',
    });

    expect(result).toEqual({ eventId: 'comment-id' });
    expect(publish).toHaveBeenCalledWith(
      ['wss://public.example'],
      expect.objectContaining({ id: 'comment-id' }),
    );
    expect(close).toHaveBeenCalledWith(['wss://public.example']);
    expect(finalizeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: [
          ['e', 'target-event', 'wss://source.example', 'root'],
          ['e', 'target-event', 'wss://source.example', 'reply'],
          ['p', 'target-pubkey'],
        ],
      }),
      expect.any(Uint8Array),
    );
  });
});
