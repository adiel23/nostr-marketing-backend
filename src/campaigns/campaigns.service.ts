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
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { Campaign, CampaignStatus } from './entities/campaign.entity';

const CAMPAIGN_MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const MSATS_PER_SAT = 1_000;
const WALLET_RESERVE_MULTIPLIER = 1.023;

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
  ): Promise<Campaign> {
    const { nwcUrl, satsPerImpact } = createCampaignDto;
    await this.validateWallet(nwcUrl, satsPerImpact);
    const endsAt = this.getValidEndsAt(createCampaignDto.endsAt, new Date());

    const newCampaign = this.campaignsRepository.create({
      companyId,
      name: createCampaignDto.name,
      productDescription: createCampaignDto.productDescription,
      keywords: createCampaignDto.keywords,
      nwcUrlEncrypted: this.cryptoService.encrypt(nwcUrl),
      satsPerImpact,
      endsAt,
      status: CampaignStatus.ACTIVE,
    });

    return this.campaignsRepository.save(newCampaign);
  }

  async findActive(companyId?: string): Promise<Campaign[]> {
    try {
      return await this.campaignsRepository.find({
        where: {
          status: CampaignStatus.ACTIVE,
          endsAt: MoreThan(new Date()),
          ...(companyId ? { companyId } : {}),
        },
        order: { createdAt: 'DESC' },
      });
    } catch {
      throw new InternalServerErrorException(
        'Error al obtener las campanas activas.',
      );
    }
  }

  findAll(companyId: string): Promise<Campaign[]> {
    return this.campaignsRepository.find({
      where: { companyId },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string): Promise<Campaign | null> {
    return this.campaignsRepository.findOne({ where: { id } });
  }

  async findOne(id: string, companyId: string): Promise<Campaign> {
    return this.findOwnedCampaign(id, companyId);
  }

  async update(
    id: string,
    updateCampaignDto: UpdateCampaignDto,
    companyId: string,
  ): Promise<Campaign> {
    const campaign = await this.findOwnedCampaign(id, companyId);
    await this.ensureCampaignIsEditable(campaign);

    const {
      name,
      productDescription,
      keywords,
      nwcUrl,
      satsPerImpact,
      endsAt: endsAtValue,
    } = updateCampaignDto;

    if (
      name === undefined &&
      productDescription === undefined &&
      keywords === undefined &&
      nwcUrl === undefined &&
      satsPerImpact === undefined &&
      endsAtValue === undefined
    ) {
      throw new BadRequestException(
        'No se proporcionaron campos actualizables para la campana.',
      );
    }

    const nextSatsPerImpact = satsPerImpact ?? campaign.satsPerImpact;
    if (nwcUrl !== undefined || satsPerImpact !== undefined) {
      const walletUrl =
        nwcUrl ?? this.cryptoService.decrypt(campaign.nwcUrlEncrypted);
      await this.validateWallet(walletUrl, nextSatsPerImpact);

      if (nwcUrl !== undefined) {
        campaign.nwcUrlEncrypted = this.cryptoService.encrypt(nwcUrl);
      }
    }

    if (name !== undefined) campaign.name = name;
    if (productDescription !== undefined)
      campaign.productDescription = productDescription;
    if (keywords !== undefined) campaign.keywords = keywords;
    if (satsPerImpact !== undefined) campaign.satsPerImpact = satsPerImpact;
    if (endsAtValue !== undefined) {
      campaign.endsAt = this.getValidEndsAt(endsAtValue, campaign.createdAt);
    }

    return this.campaignsRepository.save(campaign);
  }

  async pause(id: string, companyId: string): Promise<Campaign> {
    const campaign = await this.findOwnedCampaign(id, companyId);
    await this.ensureCampaignIsNotExpired(campaign);

    if (campaign.status === CampaignStatus.PAUSED) return campaign;
    if (campaign.status !== CampaignStatus.ACTIVE) {
      throw new ConflictException('Solo se pueden pausar campanas activas.');
    }

    campaign.status = CampaignStatus.PAUSED;
    return this.campaignsRepository.save(campaign);
  }

  async resume(id: string, companyId: string): Promise<Campaign> {
    const campaign = await this.findOwnedCampaign(id, companyId);
    await this.ensureCampaignIsNotExpired(campaign);

    if (campaign.status === CampaignStatus.ACTIVE) return campaign;
    if (campaign.status !== CampaignStatus.PAUSED) {
      throw new ConflictException('Solo se pueden reanudar campanas pausadas.');
    }

    campaign.status = CampaignStatus.ACTIVE;
    return this.campaignsRepository.save(campaign);
  }

  async remove(id: string, companyId: string): Promise<Campaign> {
    const campaign = await this.findOwnedCampaign(id, companyId);
    await this.ensureCampaignIsNotExpired(campaign);

    if (campaign.status === CampaignStatus.CANCELLED) return campaign;
    if (campaign.status === CampaignStatus.COMPLETED) {
      throw new ConflictException(
        'No se puede cancelar una campana finalizada.',
      );
    }

    campaign.status = CampaignStatus.CANCELLED;
    return this.campaignsRepository.save(campaign);
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
  ): Promise<void> {
    if (!Number.isSafeInteger(satsPerImpact) || satsPerImpact < 1) {
      throw new BadRequestException(
        'El valor de sats por impacto debe ser un entero positivo.',
      );
    }

    let client: ReturnType<typeof createNwcClient> | undefined;

    try {
      client = createNwcClient(nwcUrl);
      const response = await client.getBalance();
      const walletBalanceMsats = response.balance;
      const minimumRequiredMsats = Math.ceil(
        satsPerImpact * WALLET_RESERVE_MULTIPLIER * MSATS_PER_SAT,
      );

      if (
        !Number.isFinite(walletBalanceMsats) ||
        walletBalanceMsats < minimumRequiredMsats
      ) {
        const minimumRequiredSats = Math.ceil(
          minimumRequiredMsats / MSATS_PER_SAT,
        );
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
