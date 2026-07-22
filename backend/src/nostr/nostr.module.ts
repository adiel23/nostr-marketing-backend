import { Module, forwardRef} from '@nestjs/common';
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
import { envPort, requiredEnv } from 'src/common/env.util';

@Module({
    imports: [
        CampaignsModule,
        LlmModule,
        ImpactsModule,
        forwardRef(() => WalletModule),
        BullModule.forRoot({
        connection: {
            host: requiredEnv('REDIS_HOST'),
            port: envPort('REDIS_PORT', 6379),
            username: process.env.REDIS_USERNAME,
            password: process.env.REDIS_PASSWORD,
            family: 0,
        },
        }),
        BullModule.registerQueue({
        name: 'nostr-matches',
        }),
        BullBoardModule.forFeature({
        name: 'nostr-matches',
        adapter: BullMQAdapter, 
        }),
    ],
    providers: [NostrService, NostrPublisher, ImpactExecutionService, NostrMatchesConsumer],
    exports: [NostrService]
})
export class NostrModule {}

