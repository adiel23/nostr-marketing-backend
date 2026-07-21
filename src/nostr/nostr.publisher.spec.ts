jest.mock('nostr-tools/pure', () => ({
  finalizeEvent: jest.fn(() => ({
    id: 'comment-id',
  })),
  verifyEvent: jest.fn(() => true),
}));

const publish = jest.fn(() => [Promise.resolve()]);
const get = jest.fn();
const close = jest.fn();

jest.mock('nostr-tools/pool', () => ({
  SimplePool: jest.fn().mockImplementation(() => ({ publish, get, close })),
}));

jest.mock('./nostr-keys.util', () => ({
  getPlatformSecretKey: jest.fn(() => new Uint8Array(32)),
  getPlatformPublicKey: jest.fn(() => 'platform-pubkey'),
  getPublishRelayUrl: jest.fn(() => 'wss://public.example'),
}));

import { finalizeEvent } from 'nostr-tools/pure';
import { NostrPublisher } from './nostr.publisher';

describe('NostrPublisher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    publish.mockReturnValue([Promise.resolve()]);
    get.mockResolvedValue({
      id: 'comment-id',
      pubkey: 'platform-pubkey',
      kind: 1,
      content: 'Oferta de prueba',
      tags: [
        ['e', 'target-event', 'wss://public.example', 'root'],
        ['p', 'target-pubkey'],
      ],
    });
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
    expect(get).toHaveBeenCalledWith(
      ['wss://public.example'],
      { ids: ['comment-id'], limit: 1 },
      { maxWait: 5_000 },
    );
    expect(close).toHaveBeenCalledWith(['wss://public.example']);
    expect(finalizeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: [
          ['e', 'target-event', 'wss://public.example', 'root'],
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

  it('retries publication when the relay does not make the comment retrievable', async () => {
    get.mockResolvedValueOnce(null);
    jest.useFakeTimers();
    const publication = new NostrPublisher().publishComment({
      targetEventId: 'target-event',
      targetPubkey: 'target-pubkey',
      content: 'Oferta de prueba',
    });
    await jest.advanceTimersByTimeAsync(750);

    await expect(publication).resolves.toEqual({ eventId: 'comment-id' });

    expect(publish).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});
