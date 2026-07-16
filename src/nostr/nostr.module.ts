import { Module } from '@nestjs/common';
import { NostrService } from './nostr.service';
import { CampaignsModule } from 'src/campaigns/campaigns.module';
import { BullModule } from '@nestjs/bullmq';
import { NostrMatchesConsumer } from './nostr-matches.consumer';
import { LlmModule } from 'src/llm/llm.module';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';

@Module({
    imports: [
        CampaignsModule,
        LlmModule,
        BullModule.forRoot({
        connection: {
            host: 'redis_cache',
            port: 6379,
        },
        }),
        BullModule.registerQueue({
        name: 'nostr-matches',
        }),
        // NUEVO: Vincula la cola de este módulo al Bull Board global
        BullBoardModule.forFeature({
        name: 'nostr-matches',
        adapter: BullMQAdapter, 
        }),
    ],
    providers: [NostrService, NostrMatchesConsumer]
})
export class NostrModule {}

