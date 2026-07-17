import { DataSource } from 'typeorm';
import { Company } from './companies/entities/company.entity';
import { Campaign } from './campaigns/entities/campaign.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  username: 'root',
  password: '1234',
  database: 'nostr_marketing',
  entities: [Company, Campaign], // Las mismas entidades de tu app.module
  migrations: ['./src/migrations/*{.ts,.js}'], // Dónde se guardarán los archivos generados
});