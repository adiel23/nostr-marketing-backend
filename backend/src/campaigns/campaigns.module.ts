import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { AuthModule } from 'src/auth/auth.module';
import { Campaign } from './entities/campaign.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CryptoModule } from 'src/crypto/crypto.module';
import { Impact } from 'src/impacts/entities/impact.entity';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Campaign, Impact]), CryptoModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService]
})
export class CampaignsModule {}
