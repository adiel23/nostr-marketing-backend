import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Campaign,
  CampaignStatus,
} from './entities/campaign.entity';
import { NWCClient } from '@getalby/sdk';
import { CryptoService } from 'src/crypto/crypto.service';
import { Impact } from 'src/impacts/entities/impact.entity';
import { calculatePlatformFee } from 'src/common/fees.util';

interface ImpactTotals {
  impactsCount: number;
  totalZapSats: number;
  totalLightningFeeSats: number;
  totalPlatformFeeSats: number;
  totalSpentSats: number;
}

@Injectable()
export class CampaignsService {
  constructor(
    @InjectRepository(Campaign)
    private campaignsRepository: Repository<Campaign>,
    @InjectRepository(Impact)
    private impactsRepository: Repository<Impact>,
    private readonly cryptoService: CryptoService,
  ) {}

  async create(createCampaignDto: CreateCampaignDto, companyId: string) {
    const { nwcUrl, satsPerImpact } = createCampaignDto;
    const createdAt = new Date();
    const endsAt = new Date(createCampaignDto.endsAt);

    if (
      Number.isNaN(endsAt.getTime()) ||
      endsAt.getTime() <= createdAt.getTime()
    ) {
      throw new BadRequestException(
        'La fecha de finalización debe ser posterior a la fecha de creación.',
      );
    }

    try {
      const platformFeeRate = calculatePlatformFee(
        satsPerImpact,
        createCampaignDto.commentMode,
      );

      const minimumRequired =
        satsPerImpact + 0.003 * satsPerImpact + platformFeeRate * satsPerImpact;

      await this.validateWalletBalance(nwcUrl, minimumRequired);

      const encryptedNwcUrl = this.cryptoService.encrypt(
        createCampaignDto.nwcUrl,
      ); // Ciframos la URL antes de guardarla

      const newCampaign = this.campaignsRepository.create({
        companyId,
        name: createCampaignDto.name,
        productDescription: createCampaignDto.productDescription,
        promotionalComment: createCampaignDto.promotionalComment,
        commentMode: createCampaignDto.commentMode,
        keywords: createCampaignDto.keywords,
        nwcUrlEncrypted: encryptedNwcUrl, // Guardamos la URL cifrada
        satsPerImpact: createCampaignDto.satsPerImpact,
        endsAt: new Date(createCampaignDto.endsAt),
        status: CampaignStatus.ACTIVE, // Estado inicial de la campaña
      });

      return await this.campaignsRepository.save(newCampaign);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (this.isNwcInfoDiscoveryError(error)) {
        throw new BadRequestException(
          'No se pudo validar el balance de la wallet NWC porque el relay no devolvió el evento info kind 13194.',
        );
      }
      throw new InternalServerErrorException(`Error con la Wallet NWC`);
    }
  }

  // NUEVO MÉTODO
  async findActive(companyId?: string): Promise<Campaign[]> {
    try {
      return await this.campaignsRepository.find({
        where: {
          status: CampaignStatus.ACTIVE,
          ...(companyId && { companyId }),
        },
        order: {
          createdAt: 'DESC',
        },
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Error al obtener las campañas activas.',
      );
    }
  }

  async findAllForCompany(companyId: string) {
    const campaigns = await this.campaignsRepository.find({
      where: { companyId },
      order: { createdAt: 'DESC' },
    });

    const totalsByCampaign = await this.getTotalsByCampaign(
      campaigns.map((campaign) => campaign.id),
    );

    return campaigns.map((campaign) =>
      this.toCampaignSummary(campaign, totalsByCampaign.get(campaign.id)),
    );
  }

  async findById(id: string): Promise<Campaign | null> {
    return this.campaignsRepository.findOne({ where: { id } });
  }

  async findOneForCompany(id: string, companyId: string) {
    const campaign = await this.campaignsRepository.findOne({
      where: { id, companyId },
    });

    if (!campaign) {
      throw new NotFoundException('Campaña no encontrada.');
    }

    const impacts = await this.impactsRepository.find({
      where: { campaignId: campaign.id },
      order: { createdAt: 'DESC' },
    });

    return {
      ...this.toCampaignSummary(campaign, this.calculateTotals(impacts)),
      impacts: impacts.map((impact) => this.toPublicImpact(impact)),
    };
  }

  update(id: number, updateCampaignDto: UpdateCampaignDto) {
    return `This action updates a #${id} campaign`;
  }

  remove(id: number) {
    return `This action removes a #${id} campaign`;
  }

  private async getTotalsByCampaign(campaignIds: string[]) {
    const totalsByCampaign = new Map<string, ImpactTotals>();
    if (campaignIds.length === 0) return totalsByCampaign;

    const rows = await this.impactsRepository
      .createQueryBuilder('impact')
      .select('impact.campaignId', 'campaignId')
      .addSelect('COUNT(impact.id)', 'impactsCount')
      .addSelect('COALESCE(SUM(impact.zapSats), 0)', 'totalZapSats')
      .addSelect(
        'COALESCE(SUM(impact.lightningFeeSats), 0)',
        'totalLightningFeeSats',
      )
      .addSelect('COALESCE(SUM(impact.platformFee), 0)', 'totalPlatformFeeSats')
      .addSelect('COALESCE(SUM(impact.totalSpentSats), 0)', 'totalSpentSats')
      .where('impact.campaignId IN (:...campaignIds)', { campaignIds })
      .groupBy('impact.campaignId')
      .getRawMany();

    for (const row of rows) {
      totalsByCampaign.set(row.campaignId, {
        impactsCount: Number(row.impactsCount),
        totalZapSats: Number(row.totalZapSats),
        totalLightningFeeSats: Number(row.totalLightningFeeSats),
        totalPlatformFeeSats: Number(row.totalPlatformFeeSats),
        totalSpentSats: Number(row.totalSpentSats),
      });
    }

    return totalsByCampaign;
  }

  private calculateTotals(impacts: Impact[]): ImpactTotals {
    return impacts.reduce<ImpactTotals>(
      (totals, impact) => ({
        impactsCount: totals.impactsCount + 1,
        totalZapSats: totals.totalZapSats + (impact.zapSats ?? 0),
        totalLightningFeeSats:
          totals.totalLightningFeeSats + (impact.lightningFeeSats ?? 0),
        totalPlatformFeeSats:
          totals.totalPlatformFeeSats + (impact.platformFee ?? 0),
        totalSpentSats:
          totals.totalSpentSats +
          (impact.totalSpentSats ?? impact.satsCharged ?? 0),
      }),
      this.emptyTotals(),
    );
  }

  private toCampaignSummary(campaign: Campaign, totals?: ImpactTotals) {
    return {
      id: campaign.id,
      name: campaign.name,
      productDescription: campaign.productDescription,
      promotionalComment: campaign.promotionalComment,
      commentMode: campaign.commentMode,
      keywords: campaign.keywords,
      satsPerImpact: campaign.satsPerImpact,
      status: campaign.status,
      endsAt: campaign.endsAt,
      createdAt: campaign.createdAt,
      ...(totals ?? this.emptyTotals()),
    };
  }

  private toPublicImpact(impact: Impact) {
    return {
      id: impact.id,
      campaignId: impact.campaignId,
      targetPubkey: impact.targetPubkey,
      targetEventId: impact.targetEventId,
      targetContent: impact.targetContent,
      commentContent: impact.commentContent,
      commentEventId: impact.commentEventId,
      foundKeywords: impact.foundKeywords ?? [],
      status: impact.status,
      zapSats: impact.zapSats ?? 0,
      lightningFeeSats: impact.lightningFeeSats ?? 0,
      platformFee: impact.platformFee ?? 0,
      totalSpentSats: impact.totalSpentSats ?? impact.satsCharged ?? 0,
      createdAt: impact.createdAt,
    };
  }

  private emptyTotals(): ImpactTotals {
    return {
      impactsCount: 0,
      totalZapSats: 0,
      totalLightningFeeSats: 0,
      totalPlatformFeeSats: 0,
      totalSpentSats: 0,
    };
  }

  private async validateWalletBalance(
    nwcUrl: string,
    minimumRequired: number,
  ): Promise<void> {
    const client = new NWCClient({
      nostrWalletConnectUrl: nwcUrl,
    });

    try {
      const response = await client.getBalance();
      const walletBalanceSats = response.balance;

      console.log("balance: " + walletBalanceSats + " sats");

      if (walletBalanceSats < minimumRequired) {
        throw new BadRequestException(
          `Saldo insuficiente en la wallet. Requieres al menos ${minimumRequired} sats.`,
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw error;
    } finally {
      client.close();
    }
  }

  private isNwcInfoDiscoveryError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('no info event') ||
      message.includes('kind 13194') ||
      message.includes('Failed to request get_balance')
    );
  }
}
