import { Company } from 'src/companies/entities/company.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

export enum CampaignStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
}

export enum CampaignCommentMode {
  FIXED = 'fixed',
  AI = 'ai',
}

@Entity({ name: 'campaigns' })
export class Campaign {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // En la BD será company_id, pero en tu código usas companyId
  @Column({ name: 'company_id', type: 'uuid' })
  companyId!: string;

  // 2. Creas la relación usando @JoinColumn apuntando a 'company_id'
  @ManyToOne(() => Company, (company) => company.campaigns, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'company_id' }) // 👈 Esto une la propiedad 'company' con la columna 'company_id'
  company!: Company;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'text' })
  productDescription!: string;

  @Column({ name: 'promotional_comment', type: 'text' })
  promotionalComment!: string;

  @Column({
    name: 'comment_mode',
    type: 'enum',
    enum: CampaignCommentMode,
    default: CampaignCommentMode.FIXED,
  })
  commentMode!: CampaignCommentMode;

  @Column({ type: 'text', array: true })
  keywords!: string[];

  // En la BD será nwc_url_encrypted, en tu código nwcUrlEncrypted
  @Column({ name: 'nwc_url_encrypted', type: 'varchar' })
  nwcUrlEncrypted!: string;

  // En la BD será sats_per_impact, en tu código satsPerImpact
  @Column({ name: 'sats_per_impact', type: 'integer' })
  satsPerImpact!: number;

  @Column({
    type: 'enum',
    enum: CampaignStatus,
    default: CampaignStatus.ACTIVE, // Opcional: define un estado inicial por defecto
  })
  status!: CampaignStatus;

  // En la BD será created_at, en tu código createdAt
  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  // En la BD será ends_at, en tu código endsAt
  @Column({ name: 'ends_at', type: 'timestamp' })
  endsAt!: Date;
}
