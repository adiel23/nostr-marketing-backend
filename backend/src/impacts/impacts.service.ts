import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Impact, ImpactStatus } from './entities/impact.entity';

export interface CreateImpactInput {
  campaignId: string;
  targetPubkey: string;
  targetEventId: string;
  targetContent?: string | null;
  commentContent?: string | null;
  commentEventId?: string | null;
  foundKeywords?: string[];
  status: ImpactStatus;
  satsCharged: number;
  zapSats?: number;
  lightningFeeSats?: number;
  platformFee: number;
  totalSpentSats?: number;
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

  async findByTargetEventId(targetEventId: string): Promise<Impact | null> {
    return this.impactsRepository.findOne({ where: { targetEventId } });
  }

  async createImpact(input: CreateImpactInput): Promise<Impact> {
    try {
      const totalSpentSats = input.totalSpentSats ?? input.satsCharged;
      const impact = this.impactsRepository.create({
        ...input,
        targetContent: input.targetContent ?? null,
        commentContent: input.commentContent ?? null,
        commentEventId: input.commentEventId ?? null,
        foundKeywords: input.foundKeywords ?? [],
        zapSats: input.zapSats ?? 0,
        lightningFeeSats: input.lightningFeeSats ?? 0,
        totalSpentSats,
        satsCharged: totalSpentSats,
      });
      return await this.impactsRepository.save(impact);
    } catch (error) {
      throw new InternalServerErrorException('Error al registrar el impacto.');
    }
  }
}
