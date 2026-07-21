jest.mock('src/llm/llm.service', () => ({
  LlmService: class LlmService {},
}));

jest.mock('./impact-execution.service', () => ({
  ImpactExecutionService: class ImpactExecutionService {},
}));

import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { ImpactStatus } from 'src/impacts/entities/impact.entity';
import { LlmService } from 'src/llm/llm.service';
import { ImpactExecutionService } from './impact-execution.service';
import { NostrMatchesConsumer } from './nostr-matches.consumer';
import { CampaignJobData } from './nostr.service';

describe('NostrMatchesConsumer', () => {
  const llmService = {
    evaluateIntent: jest.fn(),
  };
  const impactExecutionService = {
    executeApprovedImpact: jest.fn(),
  };
  const jobData: CampaignJobData = {
    campaignId: 'campaign-1',
    campaignName: 'Wallet',
    productDescription: 'Wallet de Bitcoin',
    foundKeywords: ['wallet'],
    eventId: 'event-1',
    pubkey: 'a'.repeat(64),
    content: 'Busco una wallet segura',
    createdAt: 1,
  };

  let consumer: NostrMatchesConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    llmService.evaluateIntent.mockResolvedValue({
      match: true,
      reason: 'Relevant',
      confidence: 1,
    });
    consumer = new NostrMatchesConsumer(
      llmService as unknown as LlmService,
      impactExecutionService as unknown as ImpactExecutionService,
    );
  });

  function createJob(): Parameters<NostrMatchesConsumer['process']>[0] {
    return {
      id: 'job-1',
      data: jobData,
    } as unknown as Parameters<NostrMatchesConsumer['process']>[0];
  }

  it.each([new NotFoundException(), new ConflictException()])(
    'completes instead of retrying permanent campaign errors',
    async (error) => {
      impactExecutionService.executeApprovedImpact.mockRejectedValue(error);

      await expect(consumer.process(createJob())).resolves.toEqual({
        status: 'discarded',
        eventId: jobData.eventId,
      });
    },
  );

  it('rethrows transient errors so BullMQ retries them', async () => {
    impactExecutionService.executeApprovedImpact.mockRejectedValue(
      new Error('Redis unavailable'),
    );

    await expect(consumer.process(createJob())).rejects.toThrow(
      'Redis unavailable',
    );
  });

  it('logs already_redeemed without re-running external effects', async () => {
    impactExecutionService.executeApprovedImpact.mockResolvedValue({
      status: ImpactStatus.FULL_SUCCESS,
      impactId: 'impact-existing',
      commentEventId: 'comment-existing',
      zapSent: true,
      alreadyRedeemed: true,
    });
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await consumer.process(createJob());

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('already_redeemed'),
    );
    log.mockRestore();
  });
});
