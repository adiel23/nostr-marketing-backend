import { Module } from '@nestjs/common';
import { NostrService } from './nostr.service';

@Module({
    providers: [NostrService]
})
export class NostrModule {}

