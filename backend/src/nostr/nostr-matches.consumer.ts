import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { LlmService } from 'src/llm/llm.service';
import { CampaignJobData } from './nostr.service';
import { ImpactExecutionService } from './impact-execution.service';
import { Logger } from '@nestjs/common';
import { CampaignsService } from 'src/campaigns/campaigns.service';
import { CampaignStatus } from 'src/campaigns/entities/campaign.entity';

@Processor('nostr-matches')
export class NostrMatchesConsumer extends WorkerHost {
  // Le pasamos el nombre de la clase como contexto
  private readonly logger = new Logger(NostrMatchesConsumer.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly impactExecutionService: ImpactExecutionService,
    private readonly campaignsService: CampaignsService,
  ) {
    super();
  }

  async process(job: Job<CampaignJobData, any, string>): Promise<any> {
    const { campaignName, productDescription, content, eventId, pubkey } =
      job.data;

    console.log(`\n[Worker] Procesando trabajo #${job.id}`);
    console.log(
      `[Worker] Ejecutando evaluación LLM para la campaña: ${campaignName}`,
    );

    try {
      const campaign = await this.campaignsService.findById(
        job.data.campaignId,
      );
      if (!campaign || campaign.status !== CampaignStatus.ACTIVE) {
        this.logger.log(
          `[Worker] Trabajo omitido: la campaña ${job.data.campaignId} no está activa.`,
        );
        return {
          status: 'skipped_campaign_inactive',
          eventId,
        };
      }

      const evaluation = await this.llmService.evaluateIntent({
        postContent: content,
        campaignName,
        productDescription,
      });

      console.log(
        `[Worker] Evaluación LLM para ${pubkey}: ${evaluation.match ? 'MATCH' : 'NO MATCH'}`,
      );
      console.log(`[Worker] Razón: ${evaluation.reason}`);

      if (!evaluation.match) {
        return {
          status: 'skipped',
          eventId,
          reason: evaluation.reason,
        };
      }

      console.log(
        `[Worker] LLM aprobó el impacto. Ejecutando flujo atómico...`,
      );
      const impactResult =
        await this.impactExecutionService.executeApprovedImpact(job.data);

      this.logger.log(
        `[Worker] Impacto registrado (${impactResult.status}). Comment: ${impactResult.commentEventId}`,
      );

      return {
        status: 'success',
        eventId,
        evaluation,
        impact: impactResult,
      };
    } catch (error) {
      console.error(`[Worker] Error procesando el trabajo ${job.id}:`, error);
      throw error;
    }
  }
}
