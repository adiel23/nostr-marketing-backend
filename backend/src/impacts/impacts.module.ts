import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Impact } from './entities/impact.entity';
import { ImpactPayment } from './entities/impact-payment.entity';
import { ImpactsService } from './impacts.service';

@Module({
  imports: [TypeOrmModule.forFeature([Impact, ImpactPayment])],
  providers: [ImpactsService],
  exports: [ImpactsService],
})
export class ImpactsModule {}
