import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Event } from 'nostr-tools/pure';
import { In, Not, Repository } from 'typeorm';
import {
  CommentStatus,
  Impact,
  ImpactStatus,
  PaymentProgressStatus,
} from './entities/impact.entity';
import {
  ImpactPayment,
  ImpactPaymentType,
} from './entities/impact-payment.entity';

export interface CreateProcessingImpactInput {
  campaignId: string;
  targetPubkey: string;
  targetEventId: string;
  targetContent?: string | null;
  foundKeywords?: string[];
}

@Injectable()
export class ImpactsService {
  constructor(
    @InjectRepository(Impact)
    private readonly impactsRepository: Repository<Impact>,
    @InjectRepository(ImpactPayment)
    private readonly paymentsRepository: Repository<ImpactPayment>,
  ) {}

  async hasImpactForUser(
    campaignId: string,
    targetPubkey: string,
  ): Promise<boolean> {
    const count = await this.impactsRepository.count({
      where: {
        campaignId,
        targetPubkey,
        status: Not(ImpactStatus.FUNDS_INSUFFICIENT),
      },
    });
    return count > 0;
  }

  async findByTargetEventId(targetEventId: string): Promise<Impact | null> {
    return this.impactsRepository.findOne({ where: { targetEventId } });
  }

  async findRecoverable(limit = 25): Promise<Impact[]> {
    return this.impactsRepository.find({
      where: {
        status: In([
          ImpactStatus.PROCESSING,
          ImpactStatus.FEE_PENDING,
          ImpactStatus.FAILED_BEFORE_COMMENT,
        ]),
      },
      order: { updatedAt: 'ASC' },
      take: limit,
    });
  }

  async findOrCreateProcessing(
    input: CreateProcessingImpactInput,
  ): Promise<Impact> {
    const existing = await this.findByTargetEventId(input.targetEventId);
    if (existing) return existing;

    try {
      return await this.impactsRepository.save(
        this.impactsRepository.create({
          ...input,
          targetContent: input.targetContent ?? null,
          foundKeywords: input.foundKeywords ?? [],
          commentContent: null,
          commentEventId: null,
          signedComment: null,
          status: ImpactStatus.PROCESSING,
          commentStatus: CommentStatus.PENDING,
          platformFeeStatus: PaymentProgressStatus.PENDING,
          zapStatus: PaymentProgressStatus.PENDING,
        }),
      );
    } catch {
      const raced = await this.findByTargetEventId(input.targetEventId);
      if (raced) return raced;
      throw new InternalServerErrorException('Error al iniciar el impacto.');
    }
  }

  async savePreparedComment(
    impactId: string,
    content: string,
    event: Event,
  ): Promise<void> {
    await this.impactsRepository.update(impactId, {
      commentContent: content,
      commentEventId: event.id,
      signedComment: event,
      commentStatus: CommentStatus.PREPARED,
    });
  }

  async markCommentPublished(impactId: string): Promise<void> {
    await this.impactsRepository.update(impactId, {
      commentStatus: CommentStatus.PUBLISHED,
    });
  }

  async markFailedBeforeComment(impactId: string): Promise<void> {
    await this.impactsRepository.update(impactId, {
      status: ImpactStatus.FAILED_BEFORE_COMMENT,
      commentStatus: CommentStatus.FAILED,
    });
  }

  async markFundsInsufficient(impactId: string): Promise<void> {
    await this.impactsRepository.update(impactId, {
      status: ImpactStatus.FUNDS_INSUFFICIENT,
    });
  }

  async markFeePending(impactId: string): Promise<void> {
    await this.impactsRepository.update(impactId, {
      status: ImpactStatus.FEE_PENDING,
      platformFeeStatus: PaymentProgressStatus.RETRYING,
    });
  }

  async markCompleted(impactId: string, zapPaid: boolean): Promise<void> {
    await this.impactsRepository.update(impactId, {
      status: zapPaid ? ImpactStatus.FULL_SUCCESS : ImpactStatus.COMMENT_ONLY,
      platformFeeStatus: PaymentProgressStatus.PAID,
      zapStatus: zapPaid
        ? PaymentProgressStatus.PAID
        : PaymentProgressStatus.SKIPPED,
    });
  }

  async ensurePayment(
    impactId: string,
    type: ImpactPaymentType,
    amountMsats: string,
  ): Promise<ImpactPayment> {
    const existing = await this.getPayment(impactId, type);
    if (existing) return existing;
    try {
      return await this.paymentsRepository.save(
        this.paymentsRepository.create({
          impactId,
          type,
          amountMsats,
          routingFeeMsats: '0',
          status: PaymentProgressStatus.PENDING,
          invoice: null,
          paymentHash: null,
          preimage: null,
          attempts: 0,
          failureCode: null,
          failureMessage: null,
          paidAt: null,
        }),
      );
    } catch {
      const raced = await this.getPayment(impactId, type);
      if (raced) return raced;
      throw new InternalServerErrorException('Error al registrar el pago.');
    }
  }

  async getPayment(
    impactId: string,
    type: ImpactPaymentType,
  ): Promise<ImpactPayment | null> {
    return this.paymentsRepository.findOne({ where: { impactId, type } });
  }

  async savePaymentInvoice(
    paymentId: string,
    invoice: string,
    paymentHash: string | null,
  ): Promise<void> {
    await this.paymentsRepository.update(paymentId, { invoice, paymentHash });
  }

  async markPaymentPaid(
    paymentId: string,
    routingFeeMsats: string,
    preimage?: string,
  ): Promise<void> {
    await this.paymentsRepository.update(paymentId, {
      status: PaymentProgressStatus.PAID,
      routingFeeMsats,
      preimage: preimage ?? null,
      paidAt: new Date(),
      failureCode: null,
      failureMessage: null,
    });
  }

  async markPaymentSkipped(
    paymentId: string,
    code: string,
    message: string,
  ): Promise<void> {
    await this.paymentsRepository.update(paymentId, {
      status: PaymentProgressStatus.SKIPPED,
      failureCode: code,
      failureMessage: message,
    });
  }

  async recordPaymentFailure(
    paymentId: string,
    code: string,
    message: string,
    retrying: boolean,
  ): Promise<void> {
    await this.paymentsRepository.increment({ id: paymentId }, 'attempts', 1);
    await this.paymentsRepository.update(paymentId, {
      status: retrying
        ? PaymentProgressStatus.RETRYING
        : PaymentProgressStatus.FAILED,
      failureCode: code,
      failureMessage: message,
    });
  }
}
