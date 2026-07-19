jest.mock('nostr-tools/pure', () => ({
  verifyEvent: jest.fn(
    (event: { content: string; sig: string }) =>
      event.content === 'Busco una wallet segura' &&
      event.sig === 'c'.repeat(128),
  ),
}));

jest.mock('./nostr-keys.util', () => ({
  getPlatformPublicKey: jest.fn(() => 'd'.repeat(64)),
}));

import { Queue } from 'bullmq';
import type { Event } from 'nostr-tools/pure';
import { CampaignsService } from 'src/campaigns/campaigns.service';
import { CampaignJobData, NostrService } from './nostr.service';

describe('NostrService', () => {
  const campaignsService = {
    findActive: jest.fn(),
  };
  const nostrQueue = {
    add: jest.fn(),
  };

  let service: NostrService;

  beforeEach(() => {
    jest.clearAllMocks();
    nostrQueue.add.mockResolvedValue({});
    service = new NostrService(
      campaignsService as unknown as CampaignsService,
      nostrQueue as unknown as Queue<CampaignJobData>,
    );
    (
      service as unknown as {
        activeCampaigns: Array<{
          id: string;
          name: string;
          productDescription: string;
          keywords: string[];
        }>;
      }
    ).activeCampaigns = [
      {
        id: 'campaign-1',
        name: 'Wallet',
        productDescription: 'Wallet de Bitcoin',
        keywords: ['wallet'],
      },
    ];
  });

  function createEvent(overrides: Partial<Event> = {}): Event {
    return {
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      sig: 'c'.repeat(128),
      kind: 1,
      tags: [],
      content: 'Busco una wallet segura',
      created_at: Math.floor(Date.now() / 1000),
      ...overrides,
    };
  }

  async function processRelayEvent(event: Event): Promise<void> {
    await (
      service as unknown as {
        handleRelayMessage(data: string): Promise<void>;
      }
    ).handleRelayMessage(JSON.stringify(['EVENT', 'subscription-id', event]));
  }

  it('validates a signed kind-1 event before enqueuing a deduplicated job', async () => {
    const event = createEvent();

    await processRelayEvent(event);

    expect(nostrQueue.add).toHaveBeenCalledWith(
      'procesar-match',
      expect.objectContaining({
        campaignId: 'campaign-1',
        eventId: event.id,
        pubkey: event.pubkey,
      }),
      expect.objectContaining({
        attempts: 3,
        jobId: `campaign-1:${event.id}:match`,
        removeOnComplete: { age: 30 * 24 * 60 * 60 },
        removeOnFail: { age: 30 * 24 * 60 * 60 },
      }),
    );
  });

  it('rejects a forged event before it reaches BullMQ', async () => {
    const forgedEvent = {
      ...createEvent(),
      content: 'Busco una wallet manipulada',
    };

    await processRelayEvent(forgedEvent);

    expect(nostrQueue.add).not.toHaveBeenCalled();
  });

  it('rejects valid signatures outside the accepted timestamp window', async () => {
    const expiredEvent = createEvent({
      created_at: Math.floor(Date.now() / 1000) - 24 * 60 * 60 - 1,
    });

    await processRelayEvent(expiredEvent);

    expect(nostrQueue.add).not.toHaveBeenCalled();
  });

  it('rejects signed events with a kind other than text note', async () => {
    const nonTextEvent = createEvent({ kind: 7 });

    await processRelayEvent(nonTextEvent);

    expect(nostrQueue.add).not.toHaveBeenCalled();
  });

  it('clears pending reconnects during shutdown', () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const reconnectTimer = setTimeout(() => undefined, 60_000);
    const close = jest.fn();
    const internals = service as unknown as {
      reconnectTimer?: NodeJS.Timeout;
      ws?: { close(): void };
    };
    internals.reconnectTimer = reconnectTimer;
    internals.ws = { close };

    service.onModuleDestroy();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(reconnectTimer);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
