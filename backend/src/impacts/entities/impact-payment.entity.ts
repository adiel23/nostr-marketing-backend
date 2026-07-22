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
import { Impact, PaymentProgressStatus } from './impact.entity';

export enum ImpactPaymentType {
  ZAP = 'zap',
  PLATFORM_FEE = 'platform_fee',
}

@Entity({ name: 'impact_payments' })
@Index('uq_impact_payments_impact_type', ['impactId', 'type'], { unique: true })
export class ImpactPayment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'impact_id', type: 'uuid' })
  impactId!: string;

  @ManyToOne(() => Impact, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'impact_id' })
  impact!: Impact;

  @Column({ type: 'varchar' })
  type!: ImpactPaymentType;

  @Column({ type: 'varchar', default: PaymentProgressStatus.PENDING })
  status!: PaymentProgressStatus;

  @Column({ name: 'amount_msats', type: 'bigint' })
  amountMsats!: string;

  @Column({ name: 'routing_fee_msats', type: 'bigint', default: '0' })
  routingFeeMsats!: string;

  @Column({ type: 'text', nullable: true })
  invoice!: string | null;

  @Column({ name: 'payment_hash', type: 'varchar', nullable: true })
  paymentHash!: string | null;

  @Column({ type: 'varchar', nullable: true })
  preimage!: string | null;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'failure_code', type: 'varchar', nullable: true })
  failureCode!: string | null;

  @Column({ name: 'failure_message', type: 'text', nullable: true })
  failureMessage!: string | null;

  @Column({ name: 'paid_at', type: 'timestamp', nullable: true })
  paidAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
