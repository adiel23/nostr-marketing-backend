import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { LlmService, type EvaluateIntentResult } from 'src/llm/llm.service';
import { CampaignJobData } from './nostr.service';
import {
  ImpactExecutionService,
  type ImpactExecutionResult,
} from './impact-execution.service';

interface NostrMatchProcessingResult {
  status: 'success' | 'skipped' | 'discarded';
  eventId: string;
  reason?: string;
  evaluation?: EvaluateIntentResult;
  impact?: ImpactExecutionResult;
}

@Processor('nostr-matches')
export class NostrMatchesConsumer extends WorkerHost {
  private readonly logger = new Logger(NostrMatchesConsumer.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly impactExecutionService: ImpactExecutionService,
  ) {
    super();
  }

  async process(
    job: Job<CampaignJobData, NostrMatchProcessingResult, string>,
  ): Promise<NostrMatchProcessingResult> {
    const { campaignName, productDescription, content, eventId } = job.data;

    this.logger.log(`[Worker] Procesando trabajo #${job.id}`);

    try {
      const evaluation = await this.llmService.evaluateIntent({
        postContent: content,
        campaignName,
        productDescription,
      });

      this.logger.debug(
        `[Worker] Evaluación LLM: ${evaluation.match ? 'MATCH' : 'NO MATCH'}`,
      );

      if (!evaluation.match) {
        return {
          status: 'skipped',
          eventId,
          reason: evaluation.reason,
        };
      }

      this.logger.debug('[Worker] LLM aprobó el impacto.');
      const impactResult =
        await this.impactExecutionService.executeApprovedImpact(job.data);

      if (impactResult.alreadyRedeemed) {
        this.logger.log(
          `[Worker] already_redeemed: la cuenta ya redimió esta campaña; sin nuevo comentario ni zap. Impact: ${impactResult.impactId}`,
        );
      } else {
        this.logger.log(
          `[Worker] Impacto registrado (${impactResult.status}). Comment: ${impactResult.commentEventId}`,
        );
      }

      return {
        status: 'success',
        eventId,
        evaluation,
        impact: impactResult,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        this.logger.warn(
          `[Worker] Trabajo ${job.id} descartado por estado permanente de la campaña.`,
        );
        return {
          status: 'discarded',
          eventId,
        };
      }

      this.logger.error(
        `[Worker] Error transitorio procesando el trabajo ${job.id}; se reintentará.`,
      );
      throw error;
    }
  }
}
