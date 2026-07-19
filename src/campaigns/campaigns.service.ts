import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { In, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { CryptoService } from 'src/crypto/crypto.service';
import { createNwcClient } from 'src/wallet/nwc-client.util';
import { estimateImpactCostSats, MSATS_PER_SAT } from 'src/common/fees.util';
import { CampaignResponseDto } from './dto/campaign-response.dto';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { Campaign, CampaignStatus } from './entities/campaign.entity';

const CAMPAIGN_MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class CampaignsService {
  constructor(
    @InjectRepository(Campaign)
    private readonly campaignsRepository: Repository<Campaign>,
    private readonly cryptoService: CryptoService,
  ) {}

  async create(
    createCampaignDto: CreateCampaignDto,
    companyId: string,
  ): Promise<CampaignResponseDto> {
    const { nwcUrl, satsPerImpact, budgetSats } = createCampaignDto;
    await this.validateWallet(nwcUrl, satsPerImpact, budgetSats);
    const endsAt = this.getValidEndsAt(createCampaignDto.endsAt, new Date());

    const newCampaign = this.campaignsRepository.create({
      companyId,
      name: createCampaignDto.name,
      productDescription: createCampaignDto.productDescription,
      keywords: createCampaignDto.keywords,
      nwcUrlEncrypted: this.cryptoService.encrypt(nwcUrl),
      satsPerImpact,
      budgetSats,
      reservedSats: 0,
      spentSats: 0,
      endsAt,
      status: CampaignStatus.ACTIVE,
    });

    return this.toResponse(await this.campaignsRepository.save(newCampaign));
  }

  async findActive(): Promise<Campaign[]> {
    try {
      return await this.campaignsRepository.find({
        where: {
          status: CampaignStatus.ACTIVE,
          endsAt: MoreThan(new Date()),
        },
        order: { createdAt: 'DESC' },
      });
    } catch {
      throw new InternalServerErrorException(
        'Error al obtener las campanas activas.',
      );
    }
  }

  async findAll(companyId: string): Promise<CampaignResponseDto[]> {
    const campaigns = await this.campaignsRepository.find({
      where: { companyId },
      order: { createdAt: 'DESC' },
    });
    return campaigns.map((campaign) => this.toResponse(campaign));
  }

  async findById(id: string): Promise<Campaign | null> {
    return this.campaignsRepository.findOne({ where: { id } });
  }

  async findOne(id: string, companyId: string): Promise<CampaignResponseDto> {
    return this.toResponse(await this.findOwnedCampaign(id, companyId));
  }

  async update(
    id: string,
    updateCampaignDto: UpdateCampaignDto,
    companyId: string,
  ): Promise<CampaignResponseDto> {
    const campaign = await this.findOwnedCampaign(id, companyId);
    await this.ensureCampaignIsEditable(campaign);

    const {
      name,
      productDescription,
      keywords,
      nwcUrl,
      satsPerImpact,
      budgetSats,
      endsAt: endsAtValue,
    } = updateCampaignDto;

    if (
      name === undefined &&
      productDescription === undefined &&
      keywords === undefined &&
      nwcUrl === undefined &&
      satsPerImpact === undefined &&
      budgetSats === undefined &&
      endsAtValue === undefined
    ) {
      throw new BadRequestException(
        'No se proporcionaron campos actualizables para la campana.',
      );
    }

    if (budgetSats !== undefined) {
      const committedSats = campaign.reservedSats + campaign.spentSats;
      if (budgetSats < committedSats) {
        throw new BadRequestException(
          `El presupuesto no puede ser menor que lo ya reservado o gastado (${committedSats} sats).`,
        );
      }
    }

    const nextSatsPerImpact = satsPerImpact ?? campaign.satsPerImpact;
    const nextBudgetSats = budgetSats ?? campaign.budgetSats;
    if (
      nwcUrl !== undefined ||
      satsPerImpact !== undefined ||
      budgetSats !== undefined
    ) {
      const walletUrl =
        nwcUrl ?? this.cryptoService.decrypt(campaign.nwcUrlEncrypted);
      await this.validateWallet(walletUrl, nextSatsPerImpact, nextBudgetSats);

      if (nwcUrl !== undefined) {
        campaign.nwcUrlEncrypted = this.cryptoService.encrypt(nwcUrl);
      }
    }

    if (name !== undefined) campaign.name = name;
    if (productDescription !== undefined)
      campaign.productDescription = productDescription;
    if (keywords !== undefined) campaign.keywords = keywords;
    if (satsPerImpact !== undefined) campaign.satsPerImpact = satsPerImpact;
    if (budgetSats !== undefined) campaign.budgetSats = budgetSats;
    if (endsAtValue !== undefined) {
      campaign.endsAt = this.getValidEndsAt(endsAtValue, campaign.createdAt);
    }

    return this.toResponse(await this.campaignsRepository.save(campaign));
  }

  async pause(id: string, companyId: string): Promise<CampaignResponseDto> {
    const campaign = await this.findOwnedCampaign(id, companyId);
    await this.ensureCampaignIsNotExpired(campaign);

    if (campaign.status === CampaignStatus.PAUSED) {
      return this.toResponse(campaign);
    }
    if (campaign.status !== CampaignStatus.ACTIVE) {
      throw new ConflictException('Solo se pueden pausar campanas activas.');
    }

    campaign.status = CampaignStatus.PAUSED;
    return this.toResponse(await this.campaignsRepository.save(campaign));
  }

  async resume(id: string, companyId: string): Promise<CampaignResponseDto> {
    const campaign = await this.findOwnedCampaign(id, companyId);
    await this.ensureCampaignIsNotExpired(campaign);

    if (campaign.status === CampaignStatus.ACTIVE) {
      return this.toResponse(campaign);
    }
    if (campaign.status !== CampaignStatus.PAUSED) {
      throw new ConflictException('Solo se pueden reanudar campanas pausadas.');
    }

    campaign.status = CampaignStatus.ACTIVE;
    return this.toResponse(await this.campaignsRepository.save(campaign));
  }

  async remove(id: string, companyId: string): Promise<CampaignResponseDto> {
    const campaign = await this.findOwnedCampaign(id, companyId);
    await this.ensureCampaignIsNotExpired(campaign);

    if (campaign.status === CampaignStatus.CANCELLED) {
      return this.toResponse(campaign);
    }
    if (campaign.status === CampaignStatus.COMPLETED) {
      throw new ConflictException(
        'No se puede cancelar una campana finalizada.',
      );
    }

    campaign.status = CampaignStatus.CANCELLED;
    return this.toResponse(await this.campaignsRepository.save(campaign));
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async closeExpiredCampaigns(now = new Date()): Promise<void> {
    await this.campaignsRepository.update(
      {
        status: In([CampaignStatus.ACTIVE, CampaignStatus.PAUSED]),
        endsAt: LessThanOrEqual(now),
      },
      { status: CampaignStatus.COMPLETED },
    );
  }

  private toResponse(campaign: Campaign): CampaignResponseDto {
    return {
      id: campaign.id,
      companyId: campaign.companyId,
      name: campaign.name,
      productDescription: campaign.productDescription,
      keywords: campaign.keywords,
      satsPerImpact: campaign.satsPerImpact,
      budgetSats: campaign.budgetSats,
      reservedSats: campaign.reservedSats,
      spentSats: campaign.spentSats,
      status: campaign.status,
      createdAt: campaign.createdAt,
      endsAt: campaign.endsAt,
    };
  }

  private async findOwnedCampaign(
    id: string,
    companyId: string,
  ): Promise<Campaign> {
    const campaign = await this.campaignsRepository.findOne({
      where: { id, companyId },
    });

    if (!campaign) {
      throw new NotFoundException('Campana no encontrada.');
    }

    return campaign;
  }

  private async ensureCampaignIsEditable(campaign: Campaign): Promise<void> {
    await this.ensureCampaignIsNotExpired(campaign);
    if (
      campaign.status === CampaignStatus.CANCELLED ||
      campaign.status === CampaignStatus.COMPLETED
    ) {
      throw new ConflictException(
        'No se puede modificar una campana finalizada.',
      );
    }
  }

  private async ensureCampaignIsNotExpired(campaign: Campaign): Promise<void> {
    if (campaign.endsAt.getTime() > Date.now()) return;

    if (
      campaign.status === CampaignStatus.ACTIVE ||
      campaign.status === CampaignStatus.PAUSED
    ) {
      campaign.status = CampaignStatus.COMPLETED;
      await this.campaignsRepository.save(campaign);
    }

    throw new ConflictException(
      'La campana ya alcanzo su fecha de finalizacion.',
    );
  }

  private getValidEndsAt(endsAtValue: string, activatedAt: Date): Date {
    const endsAt = new Date(endsAtValue);
    if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'La fecha de finalizacion debe ser posterior a la fecha de activacion.',
      );
    }

    const latestEnd = new Date(
      activatedAt.getTime() + CAMPAIGN_MAX_DURATION_MS,
    );
    if (endsAt.getTime() > latestEnd.getTime()) {
      throw new BadRequestException(
        'La fecha de finalizacion no puede superar 30 dias desde la activacion.',
      );
    }

    return endsAt;
  }

  private async validateWallet(
    nwcUrl: string,
    satsPerImpact: number,
    budgetSats: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(satsPerImpact) || satsPerImpact < 1) {
      throw new BadRequestException(
        'El valor de sats por impacto debe ser un entero positivo.',
      );
    }

    if (!Number.isSafeInteger(budgetSats) || budgetSats < 1) {
      throw new BadRequestException(
        'El presupuesto de la campana debe ser un entero positivo.',
      );
    }

    const minimumRequiredSats = estimateImpactCostSats(satsPerImpact);
    if (budgetSats < minimumRequiredSats) {
      throw new BadRequestException(
        `El presupuesto debe cubrir al menos un impacto (${minimumRequiredSats} sats).`,
      );
    }

    let client: Awaited<ReturnType<typeof createNwcClient>> | undefined;

    try {
      client = await createNwcClient(nwcUrl);
      const response = await client.getBalance();
      const walletBalanceMsats = response.balance;
      const minimumRequiredMsats = minimumRequiredSats * MSATS_PER_SAT;

      if (
        !Number.isFinite(walletBalanceMsats) ||
        walletBalanceMsats < minimumRequiredMsats
      ) {
        throw new BadRequestException(
          `Saldo insuficiente en la wallet. Requieres al menos ${minimumRequiredSats} sats.`,
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Error con la Wallet NWC');
    } finally {
      client?.close();
    }
  }
}
