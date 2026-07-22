import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { Repository } from 'typeorm';
import { In } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Campaign, CampaignStatus } from './entities/campaign.entity';
import { NWCClient } from '@getalby/sdk';
import { CryptoService } from 'src/crypto/crypto.service';
import { Impact } from 'src/impacts/entities/impact.entity';
import {
  calculatePlatformFeeMsats,
  calculateRequiredImpactBalanceMsats,
  satsToMsats,
} from 'src/common/fees.util';
import {
  ImpactPayment,
  ImpactPaymentType,
} from 'src/impacts/entities/impact-payment.entity';
import { PaymentProgressStatus } from 'src/impacts/entities/impact.entity';

interface ImpactTotals {
  impactsCount: number;
  totalZapAmountMsats: string;
  totalZapRoutingFeeMsats: string;
  totalPlatformFeeAmountMsats: string;
  totalPlatformRoutingFeeMsats: string;
  totalSpentMsats: string;
}

interface ImpactTotalsRow extends Omit<ImpactTotals, 'impactsCount'> {
  campaignId: string;
  impactsCount: number | string;
}

@Injectable()
export class CampaignsService {
  constructor(
    @InjectRepository(Campaign)
    private campaignsRepository: Repository<Campaign>,
    @InjectRepository(Impact)
    private impactsRepository: Repository<Impact>,
    @InjectRepository(ImpactPayment)
    private paymentsRepository: Repository<ImpactPayment>,
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
      const zapAmountMsats = satsToMsats(satsPerImpact);
      const platformFeeMsats = calculatePlatformFeeMsats(
        satsPerImpact,
        createCampaignDto.commentMode,
      );
      const minimumRequired = calculateRequiredImpactBalanceMsats(
        zapAmountMsats,
        platformFeeMsats,
      );

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
    } catch {
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
    const payments = impacts.length
      ? await this.paymentsRepository.find({
          where: { impactId: In(impacts.map((impact) => impact.id)) },
        })
      : [];
    const paymentsByImpact = new Map<string, ImpactPayment[]>();
    for (const payment of payments) {
      const current = paymentsByImpact.get(payment.impactId) ?? [];
      current.push(payment);
      paymentsByImpact.set(payment.impactId, current);
    }

    return {
      ...this.toCampaignSummary(
        campaign,
        this.calculateTotals(impacts, payments),
      ),
      impacts: impacts.map((impact) =>
        this.toPublicImpact(impact, paymentsByImpact.get(impact.id) ?? []),
      ),
    };
  }

  update(id: number, updateCampaignDto: UpdateCampaignDto) {
    void updateCampaignDto;
    return `This action updates a #${id} campaign`;
  }

  remove(id: number) {
    return `This action removes a #${id} campaign`;
  }

  async markBillingBlocked(id: string): Promise<void> {
    await this.campaignsRepository.update(id, {
      status: CampaignStatus.BILLING_BLOCKED,
    });
  }

  async restoreAfterBilling(id: string): Promise<void> {
    await this.campaignsRepository.update(
      { id, status: CampaignStatus.BILLING_BLOCKED },
      { status: CampaignStatus.ACTIVE },
    );
  }

  private async getTotalsByCampaign(campaignIds: string[]) {
    const totalsByCampaign = new Map<string, ImpactTotals>();
    if (campaignIds.length === 0) return totalsByCampaign;

    const rows = await this.impactsRepository
      .createQueryBuilder('impact')
      .select('impact.campaignId', 'campaignId')
      .leftJoin(ImpactPayment, 'payment', 'payment.impact_id = impact.id')
      .addSelect('COUNT(DISTINCT impact.id)', 'impactsCount')
      .addSelect(
        `COALESCE(SUM(CASE WHEN payment.type = 'zap' AND payment.status = 'paid' THEN payment.amount_msats ELSE 0 END), 0)`,
        'totalZapAmountMsats',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN payment.type = 'zap' AND payment.status = 'paid' THEN payment.routing_fee_msats ELSE 0 END), 0)`,
        'totalZapRoutingFeeMsats',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN payment.type = 'platform_fee' AND payment.status = 'paid' THEN payment.amount_msats ELSE 0 END), 0)`,
        'totalPlatformFeeAmountMsats',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN payment.type = 'platform_fee' AND payment.status = 'paid' THEN payment.routing_fee_msats ELSE 0 END), 0)`,
        'totalPlatformRoutingFeeMsats',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN payment.status = 'paid' THEN payment.amount_msats + payment.routing_fee_msats ELSE 0 END), 0)`,
        'totalSpentMsats',
      )
      .where('impact.campaignId IN (:...campaignIds)', { campaignIds })
      .groupBy('impact.campaignId')
      .getRawMany<ImpactTotalsRow>();

    for (const row of rows) {
      totalsByCampaign.set(row.campaignId, {
        impactsCount: Number(row.impactsCount),
        totalZapAmountMsats: String(row.totalZapAmountMsats),
        totalZapRoutingFeeMsats: String(row.totalZapRoutingFeeMsats),
        totalPlatformFeeAmountMsats: String(row.totalPlatformFeeAmountMsats),
        totalPlatformRoutingFeeMsats: String(row.totalPlatformRoutingFeeMsats),
        totalSpentMsats: String(row.totalSpentMsats),
      });
    }

    return totalsByCampaign;
  }

  private calculateTotals(
    impacts: Impact[],
    payments: ImpactPayment[],
  ): ImpactTotals {
    let zapAmount = 0n;
    let zapRouting = 0n;
    let platformAmount = 0n;
    let platformRouting = 0n;
    for (const payment of payments) {
      if (payment.status !== PaymentProgressStatus.PAID) continue;
      const amount = BigInt(payment.amountMsats);
      const routing = BigInt(payment.routingFeeMsats);
      if (payment.type === ImpactPaymentType.ZAP) {
        zapAmount += amount;
        zapRouting += routing;
      } else {
        platformAmount += amount;
        platformRouting += routing;
      }
    }
    return {
      impactsCount: impacts.length,
      totalZapAmountMsats: zapAmount.toString(),
      totalZapRoutingFeeMsats: zapRouting.toString(),
      totalPlatformFeeAmountMsats: platformAmount.toString(),
      totalPlatformRoutingFeeMsats: platformRouting.toString(),
      totalSpentMsats: (
        zapAmount +
        zapRouting +
        platformAmount +
        platformRouting
      ).toString(),
    };
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

  private toPublicImpact(impact: Impact, payments: ImpactPayment[]) {
    const zap = payments.find(
      (payment) => payment.type === ImpactPaymentType.ZAP,
    );
    const platform = payments.find(
      (payment) => payment.type === ImpactPaymentType.PLATFORM_FEE,
    );
    const paidValue = (payment?: ImpactPayment) =>
      payment?.status === PaymentProgressStatus.PAID
        ? BigInt(payment.amountMsats)
        : 0n;
    const paidRouting = (payment?: ImpactPayment) =>
      payment?.status === PaymentProgressStatus.PAID
        ? BigInt(payment.routingFeeMsats)
        : 0n;
    const zapAmount = paidValue(zap);
    const zapRouting = paidRouting(zap);
    const platformAmount = paidValue(platform);
    const platformRouting = paidRouting(platform);
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
      commentStatus: impact.commentStatus,
      platformFeeStatus: impact.platformFeeStatus,
      zapStatus: impact.zapStatus,
      zapAmountMsats: zapAmount.toString(),
      zapRoutingFeeMsats: zapRouting.toString(),
      platformFeeAmountMsats: platformAmount.toString(),
      platformRoutingFeeMsats: platformRouting.toString(),
      totalSpentMsats: (
        zapAmount +
        zapRouting +
        platformAmount +
        platformRouting
      ).toString(),
      createdAt: impact.createdAt,
    };
  }

  private emptyTotals(): ImpactTotals {
    return {
      impactsCount: 0,
      totalZapAmountMsats: '0',
      totalZapRoutingFeeMsats: '0',
      totalPlatformFeeAmountMsats: '0',
      totalPlatformRoutingFeeMsats: '0',
      totalSpentMsats: '0',
    };
  }

  private async validateWalletBalance(
    nwcUrl: string,
    minimumRequired: bigint,
  ): Promise<void> {
    const client = new NWCClient({
      nostrWalletConnectUrl: nwcUrl,
    });

    try {
      const info = await client.getWalletServiceInfo();
      const methods = new Set((info.capabilities ?? []).map(String));
      const missing = ['get_balance', 'pay_invoice', 'lookup_invoice'].filter(
        (method) => !methods.has(method),
      );
      if (missing.length > 0) {
        throw new BadRequestException(
          `La conexión NWC no permite: ${missing.join(', ')}.`,
        );
      }
      const response = await client.getBalance();
      const walletBalanceMsats = BigInt(response.balance);

      if (walletBalanceMsats < minimumRequired) {
        throw new BadRequestException(
          `Saldo insuficiente en la wallet. Requieres al menos ${minimumRequired.toString()} msats.`,
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
