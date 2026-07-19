import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { timingSafeEqual } from 'crypto';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { Campaign } from './campaigns/entities/campaign.entity';
import { CompaniesModule } from './companies/companies.module';
import { Company } from './companies/entities/company.entity';
import { databaseEnvironment } from './config/environment';
import { CryptoModule } from './crypto/crypto.module';
import { Impact } from './impacts/entities/impact.entity';
import { LlmModule } from './llm/llm.module';
import { NostrModule } from './nostr/nostr.module';

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function getBullBoardMiddleware() {
  if (process.env.BULL_BOARD_ENABLED !== 'true') {
    return (_req: unknown, res: { sendStatus(status: number): void }) => {
      res.sendStatus(404);
    };
  }

  const username = process.env.BULL_BOARD_USERNAME;
  const password = process.env.BULL_BOARD_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'BULL_BOARD_USERNAME y BULL_BOARD_PASSWORD son obligatorios cuando BULL_BOARD_ENABLED=true.',
    );
  }

  const expectedAuthorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  return (
    req: { headers: { authorization?: string } },
    res: {
      setHeader(name: string, value: string): void;
      sendStatus(status: number): void;
    },
    next: () => void,
  ) => {
    if (
      !constantTimeEquals(
        req.headers.authorization ?? '',
        expectedAuthorization,
      )
    ) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      res.sendStatus(401);
      return;
    }

    next();
  };
}

@Module({
  imports: [
    NostrModule,
    CompaniesModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    BullBoardModule.forRoot({
      route: '/queues',
      adapter: ExpressAdapter,
      middleware: getBullBoardMiddleware(),
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      ...databaseEnvironment,
      entities: [Company, Campaign, Impact],
      synchronize: false,
      migrations: [__dirname + '/migrations/*{.ts,.js}'],
      migrationsRun: true,
    }),
    CampaignsModule,
    AuthModule,
    CryptoModule,
    LlmModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
