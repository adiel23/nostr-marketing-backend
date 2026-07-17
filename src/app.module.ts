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
import { LlmModule } from './llm/llm.module';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';

@Module({
  imports: [
    NostrModule, 
    CompaniesModule, 
    ScheduleModule.forRoot(),
    // Configuración global de la interfaz web de colas
    BullBoardModule.forRoot({
      route: '/queues',             // URL donde abrirás el panel
      adapter: ExpressAdapter,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'postgres_db',
      port: 5432,
      username: 'root',
      password: '1234',
      database: 'nostr_marketing',
      entities: [Company, Campaign],
      synchronize: false, 
      migrations: [__dirname + '/migrations/*{.ts,.js}'], // 2. Dónde buscará Nest las migraciones al arrancar
      migrationsRun: true, // 3. Opcional: Hace que Nest corra las migraciones pendientes automáticamente al iniciar la ap
    }),
    CampaignsModule,
    AuthModule,
    CryptoModule,
    LlmModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
