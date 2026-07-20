import { forwardRef, Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { CryptoModule } from 'src/crypto/crypto.module';
import { NostrModule } from 'src/nostr/nostr.module';

@Module({
  imports: [
    CryptoModule,
    forwardRef(() => NostrModule),
   ],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
