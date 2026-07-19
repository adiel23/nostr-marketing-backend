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
  PENDING = 'pending',
  FULL_SUCCESS = 'full_success',
  COMMENT_ONLY = 'comment_only',
}

@Entity({ name: 'impacts' })
@Index('uq_impacts_campaign_pubkey', ['campaignId', 'targetPubkey'], {
  unique: true,
})
@Index('uq_impacts_campaign_event', ['campaignId', 'targetEventId'], {
  unique: true,
})
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

  @Column({ name: 'target_event_id', type: 'varchar' })
  targetEventId!: string;

  @Column({
    type: 'enum',
    enum: ImpactStatus,
  })
  status!: ImpactStatus;

  // Monto reservado del presupuesto de la campaña al crear este impacto.
  // Se libera de campaigns.reserved_sats al completar el impacto.
  @Column({ name: 'reserved_sats', type: 'integer' })
  reservedSats!: number;

  @Column({ name: 'sats_charged', type: 'integer' })
  satsCharged!: number;

  @Column({ name: 'platform_fee', type: 'integer' })
  platformFee!: number;

  // Invoice y hash de pago, guardados justo antes de invocar payInvoice
  // para poder reconciliar el estado real con la wallet si el proceso
  // cae entre el pago y el cierre del impacto.
  @Column({ name: 'bolt11', type: 'text', nullable: true })
  bolt11!: string | null;

  @Column({ name: 'payment_hash', type: 'varchar', nullable: true })
  paymentHash!: string | null;

  @Column({ name: 'preimage', type: 'varchar', nullable: true })
  preimage!: string | null;

  @Column({ name: 'payment_attempted_at', type: 'timestamp', nullable: true })
  paymentAttemptedAt!: Date | null;

  // Id del comentario promocional realmente publicado para este impacto.
  @Column({ name: 'comment_event_id', type: 'varchar', nullable: true })
  commentEventId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;
}
