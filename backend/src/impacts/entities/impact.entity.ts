import { Campaign } from 'src/campaigns/entities/campaign.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Event } from 'nostr-tools/pure';

export enum ImpactStatus {
  PROCESSING = 'processing',
  FEE_PENDING = 'fee_pending',
  FUNDS_INSUFFICIENT = 'funds_insufficient',
  FAILED_BEFORE_COMMENT = 'failed_before_comment',
  FULL_SUCCESS = 'full_success',
  COMMENT_ONLY = 'comment_only',
}

export enum CommentStatus {
  PENDING = 'pending',
  PREPARED = 'prepared',
  PUBLISHED = 'published',
  FAILED = 'failed',
}

export enum PaymentProgressStatus {
  PENDING = 'pending',
  PAID = 'paid',
  RETRYING = 'retrying',
  SKIPPED = 'skipped',
  FAILED = 'failed',
  LEGACY_UNCOLLECTED = 'legacy_uncollected',
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

  @Column({ name: 'signed_comment', type: 'jsonb', nullable: true })
  signedComment!: Event | null;

  @Column({ name: 'found_keywords', type: 'text', array: true, default: '{}' })
  foundKeywords!: string[];

  @Column({
    type: 'enum',
    enum: ImpactStatus,
  })
  status!: ImpactStatus;

  @Column({
    name: 'comment_status',
    type: 'varchar',
    default: CommentStatus.PENDING,
  })
  commentStatus!: CommentStatus;

  @Column({
    name: 'platform_fee_status',
    type: 'varchar',
    default: PaymentProgressStatus.PENDING,
  })
  platformFeeStatus!: PaymentProgressStatus;

  @Column({
    name: 'zap_status',
    type: 'varchar',
    default: PaymentProgressStatus.PENDING,
  })
  zapStatus!: PaymentProgressStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
