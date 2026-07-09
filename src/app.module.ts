import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { NostrModule } from './nostr/nostr.module';
import { CompaniesModule } from './companies/companies.module';
import {TypeOrmModule} from "@nestjs/typeorm";
import { Company } from './companies/entities/company.entity';

@Module({
  imports: [NostrModule, CompaniesModule, TypeOrmModule.forRoot({
    type: 'postgres',
    host: 'postgres_db',
    port: 5432,
    username: 'root',
    password: '1234',
    database: 'nostr_marketing',
    entities: [Company],
    synchronize: true, // Set to false in production
  })],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
