import { Module } from '@nestjs/common';
import { NostrService } from './nostr.service';
import { CampaignsModule } from 'src/campaigns/campaigns.module';

@Module({
    imports: [CampaignsModule],
    providers: [NostrService]
})
export class NostrModule {}

