import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { NostrModule } from './nostr/nostr.module';

@Module({
  imports: [NostrModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
