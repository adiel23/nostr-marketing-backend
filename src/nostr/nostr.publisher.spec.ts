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
          ['e', 'target-event', 'wss://public.example', 'root'],
          ['e', 'target-event', 'wss://public.example', 'reply'],
          ['p', 'target-pubkey'],
        ],
      }),
      expect.any(Uint8Array),
    );
  });

  it('never leaks a private listener relay into the signed public event', async () => {
    await new NostrPublisher().publishComment({
      targetEventId: 'target-event',
      targetPubkey: 'target-pubkey',
      content: 'Oferta de prueba',
    });

    const [signedEventArg] = (finalizeEvent as jest.Mock).mock.calls[0] as [
      { tags: string[][] },
    ];
    const relayHints = signedEventArg.tags
      .filter((tag) => tag[0] === 'e')
      .map((tag) => tag[2]);

    expect(relayHints.every((hint) => hint === 'wss://public.example')).toBe(
      true,
    );
  });
});
