import { Campaign } from 'src/campaigns/entities/campaign.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ImpactStatus {
  FULL_SUCCESS = 'full_success',
  COMMENT_ONLY = 'comment_only',
}

@Entity({ name: 'impacts' })
@Index('idx_impacts_campaign_pubkey', ['campaignId', 'targetPubkey'])
export class Impact {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'campaign_id', type: 'uuid' })
  campaignId!: string;

  @ManyToOne(() => Campaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign!: Campaign;

  @Column({ name: 'target_pubkey', type: 'varchar' })
  targetPubkey!: string;

  @Column({ name: 'target_event_id', type: 'varchar', unique: true })
  targetEventId!: string;

  @Column({
    type: 'enum',
    enum: ImpactStatus,
  })
  status!: ImpactStatus;

  @Column({ name: 'sats_charged', type: 'integer' })
  satsCharged!: number;

  @Column({ name: 'platform_fee', type: 'integer' })
  platformFee!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;
}
