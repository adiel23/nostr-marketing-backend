import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Campaign, CampaignStatus } from './entities/campaign.entity';
import { NWCClient } from '@getalby/sdk';
import { CryptoService } from 'src/crypto/crypto.service';

@Injectable()
export class CampaignsService {
  constructor(
    @InjectRepository(Campaign) 
    private campaignsRepository: Repository<Campaign>,
    private readonly cryptoService: CryptoService
  ) {}

  async create(createCampaignDto: CreateCampaignDto, companyId: string) {
    const { nwcUrl, satsPerImpact} = createCampaignDto;
    const createdAt = new Date();
    const endsAt = new Date(createCampaignDto.endsAt);

    if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= createdAt.getTime()) {
      throw new BadRequestException(
        'La fecha de finalización debe ser posterior a la fecha de creación.'
      );
    }

    // 1. Instanciamos el cliente con la URL del DTO
    const client = new NWCClient({
      nostrWalletConnectUrl: nwcUrl,
    });

    try {
      // 2. Pedimos el balance a la red Nostr/Lightning
      const response = await client.getBalance();
      const walletBalanceSats = response.balance; // Balance actual del usuario en sats

      // REVISAR ESTA LOGICA LUEGO!!!!
      const minimumRequired = satsPerImpact + (0.003 * satsPerImpact) + (0.02 * satsPerImpact);

      // 3. Validamos los fondos
      if (walletBalanceSats < minimumRequired) {
        throw new BadRequestException(
          `Saldo insuficiente en la wallet. Requieres al menos ${minimumRequired} sats.`
        );
      }

      // 4. TODO: Tu lógica para guardar la campaña en la base de datos...

      const encryptedNwcUrl = this.cryptoService.encrypt(createCampaignDto.nwcUrl); // Ciframos la URL antes de guardarla

      const newCampaign = this.campaignsRepository.create({
        companyId,
        name: createCampaignDto.name,
        description: createCampaignDto.description,
        keywords: createCampaignDto.keywords,
        nwcUrlEncrypted: encryptedNwcUrl, // Guardamos la URL cifrada
        satsPerImpact: createCampaignDto.satsPerImpact,
        endsAt: new Date(createCampaignDto.endsAt),
        status: CampaignStatus.ACTIVE, // Estado inicial de la campaña
      });

      return await this.campaignsRepository.save(newCampaign);

    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException(`Error con la Wallet NWC`);
    } finally {
      client.close();
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
      throw new InternalServerErrorException('Error al obtener las campañas activas.');
    }
  }

  findAll() {
    return `This action returns all campaigns`;
  }

  findOne(id: number) {
    return `This action returns a #${id} campaign`;
  }

  update(id: number, updateCampaignDto: UpdateCampaignDto) {
    return `This action updates a #${id} campaign`;
  }

  remove(id: number) {
    return `This action removes a #${id} campaign`;
  }
}
