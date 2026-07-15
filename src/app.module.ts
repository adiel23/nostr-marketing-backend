import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { NostrModule } from './nostr/nostr.module';
import { CompaniesModule } from './companies/companies.module';
import {TypeOrmModule} from "@nestjs/typeorm";
import { Company } from './companies/entities/company.entity';
import { CampaignsModule } from './campaigns/campaigns.module';
import { AuthModule } from './auth/auth.module';
import { Campaign } from './campaigns/entities/campaign.entity';
import { CryptoModule } from './crypto/crypto.module';
import {ScheduleModule} from "@nestjs/schedule";

@Module({
  imports: [
    NostrModule, 
    CompaniesModule, 
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'postgres_db',
      port: 5432,
      username: 'root',
      password: '1234',
      database: 'nostr_marketing',
      entities: [Company, Campaign],
      synchronize: true, // Set to false in production
    }),
    CampaignsModule,
    AuthModule,
    CryptoModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
