import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { LlmService } from 'src/llm/llm.service';
import { CampaignJobData } from './nostr.service';
import { ImpactExecutionService } from './impact-execution.service';

@Processor('nostr-matches')
export class NostrMatchesConsumer extends WorkerHost {
  constructor(
    private readonly llmService: LlmService,
    private readonly impactExecutionService: ImpactExecutionService,
  ) {
    super();
  }

  async process(job: Job<CampaignJobData, any, string>): Promise<any> {
    const { campaignName, productDescription, content, eventId, pubkey } = job.data;

    console.log(`\n[Worker] Procesando trabajo #${job.id}`);
    console.log(`[Worker] Ejecutando evaluación LLM para la campaña: ${campaignName}`);

    try {
      const evaluation = await this.llmService.evaluateIntent({
        postContent: content,
        campaignName,
        productDescription,
      });

      console.log(`[Worker] Evaluación LLM para ${pubkey}: ${evaluation.match ? 'MATCH' : 'NO MATCH'}`);
      console.log(`[Worker] Razón: ${evaluation.reason}`);

      if (!evaluation.match) {
        return {
          status: 'skipped',
          eventId,
          reason: evaluation.reason,
        };
      }

      console.log(`[Worker] LLM aprobó el impacto. Ejecutando flujo atómico...`);
      const impactResult = await this.impactExecutionService.executeApprovedImpact(job.data);

      console.log(
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