import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  LessThanOrEqual,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { Impact, ImpactStatus } from './entities/impact.entity';

export interface ReserveImpactInput {
  campaignId: string;
  targetPubkey: string;
  targetEventId: string;
  reserveSats: number;
}

export interface CompleteImpactInput {
  status: ImpactStatus;
  satsCharged: number;
  platformFee: number;
  preimage?: string;
  commentEventId?: string;
}

export interface ImpactReservation {
  impact: Impact;
  reserved: boolean;
}

export class BudgetExceededException extends ConflictException {
  constructor() {
    super('El presupuesto de la campana no permite este impacto.');
  }
}

/**
 * Un impacto para este mismo pubkey/evento ya esta reservado y en curso.
 * A diferencia de BudgetExceededException (permanente), esto es
 * transitorio: el trabajo debe reintentarse y, si el pending queda
 * huerfano, el reconciliador lo cerrara a un estado final.
 */
export class ImpactPendingException extends Error {
  constructor() {
    super('El impacto ya esta siendo procesado.');
  }
}

@Injectable()
export class ImpactsService {
  constructor(
    @InjectRepository(Impact)
    private readonly impactsRepository: Repository<Impact>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Impactos pending cuya reserva de pago quedo huerfana (proceso caido,
   * timeout de wallet, etc.), listos para que el reconciliador los cierre.
   */
  async findStalePending(before: Date): Promise<Impact[]> {
    return this.impactsRepository.find({
      where: {
        status: ImpactStatus.PENDING,
        createdAt: LessThanOrEqual(before),
      },
    });
  }

  /**
   * Reserva atómica: incrementa el gasto reservado de la campaña solo si
   * cabe dentro del presupuesto, e inserta el impacto en la misma
   * transacción. Si la campaña no tiene presupuesto suficiente, ninguna
   * fila cambia. Si el impacto ya existe (colisión de índice único), la
   * transacción hace rollback y la reserva de presupuesto se deshace.
   */
  async reserveImpact(input: ReserveImpactInput): Promise<ImpactReservation> {
    // Priorizamos una redencion existente antes de comprobar el presupuesto.
    // Asi un segundo post de la misma cuenta queda auditado como duplicado aun
    // cuando el primer impacto ya consumio todo el presupuesto de la campana.
    const existingImpact = await this.findExistingImpact(input);
    if (existingImpact) {
      if (existingImpact.status === ImpactStatus.PENDING) {
        throw new ImpactPendingException();
      }
      return { impact: existingImpact, reserved: false };
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const queryResult: unknown = await manager.query(
          `UPDATE campaigns
           SET reserved_sats = reserved_sats + $1
           WHERE id = $2 AND reserved_sats + spent_sats + $1 <= budget_sats
           RETURNING id`,
          [input.reserveSats, input.campaignId],
        );
        // TypeORM/Postgres devuelve UPDATE ... RETURNING como
        // [rows, affectedRows], mientras SELECT devuelve directamente rows.
        // Normalizamos ambas formas antes de decidir si se consiguio reserva.
        const rows: unknown[] = Array.isArray(queryResult)
          ? Array.isArray(queryResult[0])
            ? queryResult[0]
            : queryResult
          : [];

        if (rows.length === 0) {
          throw new BudgetExceededException();
        }

        const impact = manager.create(Impact, {
          campaignId: input.campaignId,
          targetPubkey: input.targetPubkey,
          targetEventId: input.targetEventId,
          status: ImpactStatus.PENDING,
          reservedSats: input.reserveSats,
          satsCharged: 0,
          platformFee: 0,
        });

        return {
          impact: await manager.save(impact),
          reserved: true,
        };
      });
    } catch (error) {
      if (error instanceof BudgetExceededException) throw error;

      if (!this.isUniqueConstraintError(error)) {
        throw new InternalServerErrorException('Error al reservar el impacto.');
      }

      const impact = await this.findExistingImpact(input);

      if (!impact) {
        throw new InternalServerErrorException(
          'Error al registrar el impacto.',
        );
      }

      if (impact.status === ImpactStatus.PENDING) {
        throw new ImpactPendingException();
      }

      return { impact, reserved: false };
    }
  }

  /**
   * Registra la invoice y el hash de pago justo antes de invocar
   * payInvoice, para que el reconciliador pueda verificar el resultado
   * real con la wallet si el proceso muere antes de completeImpact.
   */
  async recordPaymentAttempt(
    impactId: string,
    input: { bolt11: string; paymentHash: string },
  ): Promise<void> {
    await this.impactsRepository.update(
      { id: impactId, status: ImpactStatus.PENDING },
      {
        bolt11: input.bolt11,
        paymentHash: input.paymentHash,
        paymentAttemptedAt: new Date(),
      },
    );
  }

  /**
   * Libera la reserva de presupuesto de la campaña y confirma el gasto
   * real (satsCharged puede diferir de la reserva por comisiones reales)
   * en la misma transacción que cierra el impacto.
   */
  async completeImpact(
    impactId: string,
    input: CompleteImpactInput,
  ): Promise<Impact> {
    return this.dataSource.transaction(async (manager) => {
      const impact = await manager.findOne(Impact, {
        where: { id: impactId, status: ImpactStatus.PENDING },
      });

      if (!impact) {
        throw new InternalServerErrorException(
          'No se pudo completar la reserva del impacto.',
        );
      }

      await manager.query(
        `UPDATE campaigns
         SET reserved_sats = reserved_sats - $1, spent_sats = spent_sats + $2
         WHERE id = $3`,
        [impact.reservedSats, input.satsCharged, impact.campaignId],
      );

      const result = await manager.update(
        Impact,
        { id: impactId, status: ImpactStatus.PENDING },
        {
          status: input.status,
          satsCharged: input.satsCharged,
          platformFee: input.platformFee,
          preimage: input.preimage ?? null,
          commentEventId: input.commentEventId ?? null,
        },
      );

      if (!result.affected) {
        throw new InternalServerErrorException(
          'No se pudo completar la reserva del impacto.',
        );
      }

      return manager.findOneByOrFail(Impact, { id: impactId });
    });
  }

  private isUniqueConstraintError(error: unknown): error is QueryFailedError {
    return (
      error instanceof QueryFailedError &&
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
    );
  }

  private async findExistingImpact(
    input: ReserveImpactInput,
  ): Promise<Impact | null> {
    return this.impactsRepository.findOne({
      where: [
        { campaignId: input.campaignId, targetEventId: input.targetEventId },
        { campaignId: input.campaignId, targetPubkey: input.targetPubkey },
      ],
    });
  }
}
