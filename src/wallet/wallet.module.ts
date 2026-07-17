import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { CryptoModule } from 'src/crypto/crypto.module';

@Module({
  imports: [CryptoModule],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
