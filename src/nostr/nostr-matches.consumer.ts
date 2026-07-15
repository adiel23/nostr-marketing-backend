// nostr-matches.consumer.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { CampaignJobData } from './nostr.service';

@Processor('nostr-matches') // Debe coincidir con el nombre de la cola registrado
export class NostrMatchesConsumer extends WorkerHost {
  
  // Este método se ejecutará asíncronamente en el fondo por cada elemento en la cola
  async process(job: Job<CampaignJobData, any, string>): Promise<any> {
    const { campaignName, foundKeywords, eventId } = job.data;

    console.log(`\n[Worker] Procesando trabajo #${job.id}`);
    console.log(`[Worker] Ejecutando acción pesada para la campaña: ${campaignName}`);
    console.log(`[Worker] Keywords gatilladas: ${foundKeywords.join(', ')}`);

    try {
      // -------------------------------------------------------------
      // AQUÍ VA TU LÓGICA DE NEGOCIO REAL:
      // Ej: await this.metricsService.saveMatch(job.data);
      // Ej: await this.notificationsService.sendAlert(job.data);
      // -------------------------------------------------------------
      
      // Simulamos un retraso de procesamiento pesado (ej. guardar en DB o llamar API)
      await new Promise(resolve => setTimeout(resolve, 1000)); 

      console.log(`[Worker] Trabajo #${job.id} completado con éxito.`);
      return { status: 'success', eventId };

    } catch (error) {
      console.error(`[Worker] Error procesando el trabajo ${job.id}:`, error);
      // Lanzar el error le dice a BullMQ que la tarea falló para que aplique los reintentos
      throw error; 
    }
  }
}