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

  @Column({ name: 'target_content', type: 'text', nullable: true })
  targetContent!: string | null;

  @Column({ name: 'comment_content', type: 'text', nullable: true })
  commentContent!: string | null;

  @Column({ name: 'comment_event_id', type: 'varchar', nullable: true })
  commentEventId!: string | null;

  @Column({ name: 'found_keywords', type: 'text', array: true, default: '{}' })
  foundKeywords!: string[];

  @Column({
    type: 'enum',
    enum: ImpactStatus,
  })
  status!: ImpactStatus;

  @Column({ name: 'sats_charged', type: 'integer' })
  satsCharged!: number;

  @Column({ name: 'zap_sats', type: 'integer', default: 0 })
  zapSats!: number;

  @Column({ name: 'lightning_fee_sats', type: 'integer', default: 0 })
  lightningFeeSats!: number;

  @Column({ name: 'platform_fee', type: 'integer' })
  platformFee!: number;

  @Column({ name: 'total_spent_sats', type: 'integer', default: 0 })
  totalSpentSats!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;
}
