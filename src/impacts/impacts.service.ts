import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Impact, ImpactStatus } from './entities/impact.entity';

export interface ReserveImpactInput {
  campaignId: string;
  targetPubkey: string;
  targetEventId: string;
}

export interface CompleteImpactInput {
  status: ImpactStatus;
  satsCharged: number;
  platformFee: number;
}

export interface ImpactReservation {
  impact: Impact;
  reserved: boolean;
}

@Injectable()
export class ImpactsService {
  constructor(
    @InjectRepository(Impact)
    private readonly impactsRepository: Repository<Impact>,
  ) {}

  async hasImpactForUser(
    campaignId: string,
    targetPubkey: string,
  ): Promise<boolean> {
    const count = await this.impactsRepository.count({
      where: { campaignId, targetPubkey },
    });
    return count > 0;
  }

  async findByCampaignAndTargetEvent(
    campaignId: string,
    targetEventId: string,
  ): Promise<Impact | null> {
    return this.impactsRepository.findOne({
      where: { campaignId, targetEventId },
    });
  }

  async reserveImpact(input: ReserveImpactInput): Promise<ImpactReservation> {
    try {
      const impact = this.impactsRepository.create({
        ...input,
        status: ImpactStatus.PENDING,
        satsCharged: 0,
        platformFee: 0,
      });
      return {
        impact: await this.impactsRepository.save(impact),
        reserved: true,
      };
    } catch (error) {
      if (!(error instanceof QueryFailedError)) {
        throw new InternalServerErrorException('Error al reservar el impacto.');
      }

      const impact = await this.impactsRepository.findOne({
        where: [
          { campaignId: input.campaignId, targetEventId: input.targetEventId },
          { campaignId: input.campaignId, targetPubkey: input.targetPubkey },
        ],
      });

      if (impact) {
        return { impact, reserved: false };
      }

      throw new InternalServerErrorException('Error al registrar el impacto.');
    }
  }

  async completeImpact(
    impactId: string,
    input: CompleteImpactInput,
  ): Promise<Impact> {
    const result = await this.impactsRepository.update(
      { id: impactId, status: ImpactStatus.PENDING },
      input,
    );

    if (!result.affected) {
      throw new InternalServerErrorException(
        'No se pudo completar la reserva del impacto.',
      );
    }

    const impact = await this.impactsRepository.findOneByOrFail({
      id: impactId,
    });
    return impact;
  }
}
