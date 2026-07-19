import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import {
  BudgetExceededException,
  ImpactPendingException,
  ImpactsService,
} from './impacts.service';
import { Impact, ImpactStatus } from './entities/impact.entity';

interface FakeCampaignRow {
  reservedSats: number;
  spentSats: number;
  budgetSats: number;
}

function createFakeManager(
  campaign: FakeCampaignRow,
  impacts: Map<string, Impact>,
) {
  return {
    query: jest.fn((sql: string, params: unknown[]) => {
      if (sql.includes('reserved_sats + $1')) {
        const [reserveSats] = params as [number];
        if (
          campaign.reservedSats + campaign.spentSats + reserveSats <=
          campaign.budgetSats
        ) {
          campaign.reservedSats += reserveSats;
          return [[{ id: 'campaign-1' }], 1];
        }
        return [[], 0];
      }

      if (sql.includes('reserved_sats - $1')) {
        const [releaseSats, spentDelta] = params as [number, number];
        campaign.reservedSats -= releaseSats;
        campaign.spentSats += spentDelta;
        return [];
      }

      throw new Error(`unexpected query: ${sql}`);
    }),
    create: jest.fn((_entity: unknown, data: Partial<Impact>) => ({
      id: `impact-${impacts.size + 1}`,
      createdAt: new Date(),
      ...data,
    })) as unknown as jest.Mock,
    save: jest.fn((impact: Impact) => {
      const key = `${impact.campaignId}:${impact.targetPubkey}:${impact.targetEventId}`;
      const duplicate = [...impacts.values()].find(
        (existing) =>
          existing.campaignId === impact.campaignId &&
          (existing.targetPubkey === impact.targetPubkey ||
            existing.targetEventId === impact.targetEventId),
      );
      if (duplicate) {
        const driverError = Object.assign(
          new Error('duplicate key value violates unique constraint'),
          { code: '23505' },
        );
        throw new QueryFailedError('insert into impacts', [], driverError);
      }
      impacts.set(key, impact);
      return impact;
    }),
    findOne: jest.fn(
      (
        _entity: unknown,
        { where }: { where: { id: string; status: ImpactStatus } },
      ) => {
        const impact = [...impacts.values()].find(
          (candidate) =>
            candidate.id === where.id && candidate.status === where.status,
        );
        return impact ?? null;
      },
    ),
    update: jest.fn(
      (
        _entity: unknown,
        criteria: { id: string; status: ImpactStatus },
        input: Partial<Impact>,
      ) => {
        const impact = [...impacts.values()].find(
          (candidate) =>
            candidate.id === criteria.id &&
            candidate.status === criteria.status,
        );
        if (!impact) return { affected: 0 };
        Object.assign(impact, input);
        return { affected: 1 };
      },
    ),
    findOneByOrFail: jest.fn((_entity: unknown, { id }: { id: string }) => {
      const impact = impacts.get(
        [...impacts.keys()].find((key) => impacts.get(key)?.id === id) ?? '',
      );
      if (!impact) throw new Error('not found');
      return impact;
    }),
  };
}

describe('ImpactsService', () => {
  let impactsRepository: { findOne: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let service: ImpactsService;
  let campaign: FakeCampaignRow;
  let impacts: Map<string, Impact>;

  beforeEach(() => {
    campaign = { reservedSats: 0, spentSats: 0, budgetSats: 250 };
    impacts = new Map();
    impactsRepository = { findOne: jest.fn() };
    dataSource = {
      // Simula el rollback real de Postgres: si el callback lanza, se
      // descarta cualquier mutación que haya hecho sobre `campaign`.
      transaction: jest.fn(async (callback: (manager: unknown) => unknown) => {
        const snapshot = { ...campaign };
        try {
          return await callback(createFakeManager(campaign, impacts));
        } catch (error) {
          Object.assign(campaign, snapshot);
          throw error;
        }
      }),
    };
    service = new ImpactsService(
      impactsRepository as never,
      dataSource as never,
    );
  });

  it('reserves an impact atomically when it fits the remaining budget', async () => {
    const result = await service.reserveImpact({
      campaignId: 'campaign-1',
      targetPubkey: 'pubkey-1',
      targetEventId: 'event-1',
      reserveSats: 100,
    });

    expect(result.reserved).toBe(true);
    expect(result.impact.status).toBe(ImpactStatus.PENDING);
    expect(campaign.reservedSats).toBe(100);
  });

  it('rejects a reservation that would exceed the campaign budget', async () => {
    campaign.budgetSats = 100;

    await expect(
      service.reserveImpact({
        campaignId: 'campaign-1',
        targetPubkey: 'pubkey-1',
        targetEventId: 'event-1',
        reserveSats: 150,
      }),
    ).rejects.toBeInstanceOf(BudgetExceededException);

    expect(campaign.reservedSats).toBe(0);
    expect(impacts.size).toBe(0);
  });

  it('never lets concurrent reservations exceed the budget', async () => {
    campaign.budgetSats = 250;
    const reservationCost = 100;

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        service.reserveImpact({
          campaignId: 'campaign-1',
          targetPubkey: `pubkey-${index}`,
          targetEventId: `event-${index}`,
          reserveSats: reservationCost,
        }),
      ),
    );

    const reservedCount = results.filter(
      (result) => result.status === 'fulfilled' && result.value.reserved,
    ).length;
    const rejectedCount = results.filter(
      (result) =>
        result.status === 'rejected' &&
        result.reason instanceof BudgetExceededException,
    ).length;

    expect(reservedCount).toBe(2);
    expect(rejectedCount).toBe(3);
    expect(campaign.reservedSats).toBe(reservedCount * reservationCost);
    expect(campaign.reservedSats).toBeLessThanOrEqual(campaign.budgetSats);
  });

  it('treats a duplicate impact still pending as transient, not final', async () => {
    await service.reserveImpact({
      campaignId: 'campaign-1',
      targetPubkey: 'pubkey-1',
      targetEventId: 'event-1',
      reserveSats: 100,
    });

    const existing = [...impacts.values()][0];
    impactsRepository.findOne.mockResolvedValue(existing);

    await expect(
      service.reserveImpact({
        campaignId: 'campaign-1',
        targetPubkey: 'pubkey-1',
        targetEventId: 'event-2',
        reserveSats: 100,
      }),
    ).rejects.toBeInstanceOf(ImpactPendingException);
    expect(campaign.reservedSats).toBe(100);
  });

  it('treats a duplicate already-resolved impact as already-reserved', async () => {
    await service.reserveImpact({
      campaignId: 'campaign-1',
      targetPubkey: 'pubkey-1',
      targetEventId: 'event-1',
      reserveSats: 100,
    });

    const existing = [...impacts.values()][0];
    existing.status = ImpactStatus.FULL_SUCCESS;
    impactsRepository.findOne.mockResolvedValue(existing);

    const result = await service.reserveImpact({
      campaignId: 'campaign-1',
      targetPubkey: 'pubkey-1',
      targetEventId: 'event-2',
      reserveSats: 100,
    });

    expect(result.reserved).toBe(false);
    expect(result.impact).toBe(existing);
    expect(campaign.reservedSats).toBe(100);
  });

  it('throws when a non-duplicate database error occurs during reservation', async () => {
    dataSource.transaction.mockImplementationOnce(() => {
      throw new Error('connection lost');
    });

    await expect(
      service.reserveImpact({
        campaignId: 'campaign-1',
        targetPubkey: 'pubkey-1',
        targetEventId: 'event-1',
        reserveSats: 100,
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('releases the reservation and confirms the real spend on completion', async () => {
    const reservation = await service.reserveImpact({
      campaignId: 'campaign-1',
      targetPubkey: 'pubkey-1',
      targetEventId: 'event-1',
      reserveSats: 103,
    });

    const completed = await service.completeImpact(reservation.impact.id, {
      status: ImpactStatus.FULL_SUCCESS,
      satsCharged: 105,
      platformFee: 2,
    });

    expect(completed.status).toBe(ImpactStatus.FULL_SUCCESS);
    expect(campaign.reservedSats).toBe(0);
    expect(campaign.spentSats).toBe(105);
  });

  it('BudgetExceededException is a ConflictException', () => {
    expect(new BudgetExceededException()).toBeInstanceOf(ConflictException);
  });
});
