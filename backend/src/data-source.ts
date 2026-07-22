import { DataSource } from 'typeorm';
import { Company } from './companies/entities/company.entity';
import { Campaign } from './campaigns/entities/campaign.entity';
import { Impact } from './impacts/entities/impact.entity';
import { ImpactPayment } from './impacts/entities/impact-payment.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  username: 'root',
  password: '1234',
  database: 'nostr_marketing',
  entities: [Company, Campaign, Impact, ImpactPayment],
  migrations: ['./src/migrations/*{.ts,.js}'], // Dónde se guardarán los archivos generados
});
