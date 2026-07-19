import { Module } from '@nestjs/common';
import { NostrService } from './nostr.service';
import { CampaignsModule } from 'src/campaigns/campaigns.module';
import { BullModule } from '@nestjs/bullmq';
import { NostrMatchesConsumer } from './nostr-matches.consumer';
import { LlmModule } from 'src/llm/llm.module';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { NostrPublisher } from './nostr.publisher';
import { ImpactExecutionService } from './impact-execution.service';
import { ImpactsModule } from 'src/impacts/impacts.module';
import { WalletModule } from 'src/wallet/wallet.module';
import { redisEnvironment } from 'src/config/environment';

@Module({
  imports: [
    CampaignsModule,
    LlmModule,
    ImpactsModule,
    WalletModule,
    BullModule.forRoot({
      connection: redisEnvironment,
    }),
    BullModule.registerQueue({
      name: 'nostr-matches',
    }),
    BullBoardModule.forFeature({
      name: 'nostr-matches',
      adapter: BullMQAdapter,
    }),
  ],
  providers: [
    NostrService,
    NostrPublisher,
    ImpactExecutionService,
    NostrMatchesConsumer,
  ],
})
export class NostrModule {}
