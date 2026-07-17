import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Impact } from './entities/impact.entity';
import { ImpactsService } from './impacts.service';

@Module({
  imports: [TypeOrmModule.forFeature([Impact])],
  providers: [ImpactsService],
  exports: [ImpactsService],
})
export class ImpactsModule {}
