import { DataSource } from 'typeorm';
import { Company } from './companies/entities/company.entity';
import { Campaign } from './campaigns/entities/campaign.entity';
import { Impact } from './impacts/entities/impact.entity';
import { ImpactPayment } from './impacts/entities/impact-payment.entity';
import { envPort, requiredEnv } from './common/env.util';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: requiredEnv('DB_HOST'),
  port: envPort('DB_PORT', 5432),
  username: requiredEnv('DB_USERNAME'),
  password: requiredEnv('DB_PASSWORD'),
  database: requiredEnv('DB_NAME'),
  entities: [Company, Campaign, Impact, ImpactPayment],
  migrations: ['./src/migrations/*{.ts,.js}'], // Dónde se guardarán los archivos generados
});
