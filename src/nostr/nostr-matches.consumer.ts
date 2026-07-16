import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { LlmService } from 'src/llm/llm.service';
import { CampaignJobData } from './nostr.service';

@Processor('nostr-matches')
export class NostrMatchesConsumer extends WorkerHost {
  constructor(private readonly llmService: LlmService) {
    super();
  }

  async process(job: Job<CampaignJobData, any, string>): Promise<any> {
    const { campaignName, campaignDescription, content, eventId, pubkey, productDescription } = job.data;

    console.log(`\n[Worker] Procesando trabajo #${job.id}`);
    console.log(`[Worker] Ejecutando evaluación LLM para la campaña: ${campaignName}`);

    try {
      const evaluation = await this.llmService.evaluateIntent({
        postContent: content,
        campaignDescription,
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

      return {
        status: 'success',
        eventId,
        evaluation,
      };
    } catch (error) {
      console.error(`[Worker] Error procesando el trabajo ${job.id}:`, error);
      throw error;
    }
  }
}