import { Module } from '@nestjs/common';
import { NostrService } from './nostr.service';
import { CampaignsModule } from 'src/campaigns/campaigns.module';
import { BullModule } from '@nestjs/bullmq'; // Importamos BullModule para la cola de trabajos
import { NostrMatchesConsumer } from './nostr-matches.consumer';

@Module({
    imports: [
        CampaignsModule,
        // 1. Configurar la conexión global a Redis
        BullModule.forRoot({
        connection: {
            host: 'redis_cache',
            port: 6379,
        },
        }),
        // 2. Registrar la cola específica para los matches
        BullModule.registerQueue({
        name: 'nostr-matches',
        }),
    ],
    providers: [NostrService, NostrMatchesConsumer]
})
export class NostrModule {}

