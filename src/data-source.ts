import { DataSource } from 'typeorm';
import { Company } from './companies/entities/company.entity';
import { Campaign } from './campaigns/entities/campaign.entity';
import { Impact } from './impacts/entities/impact.entity';
import { databaseEnvironment } from './config/environment';

export const AppDataSource = new DataSource({
  type: 'postgres',
  ...databaseEnvironment,
  entities: [Company, Campaign, Impact],
  migrations: ['./src/migrations/*{.ts,.js}'], // Dónde se guardarán los archivos generados
});
