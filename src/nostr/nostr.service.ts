import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import WebSocket from 'ws';
import {CampaignsService} from "src/campaigns/campaigns.service";
import { Cron, CronExpression } from '@nestjs/schedule';

export interface CampaignKeywords {
  id: string;
  name: string;
  keywords: string[];
}

@Injectable()
export class NostrService implements OnModuleInit, OnModuleDestroy {
  private ws!: WebSocket;
  // Usamos un relay público conocido para pruebas
  private readonly relayUrl = 'wss://relay.damus.io'; 

  constructor(
    private campaignsService: CampaignsService // Inyectaremos el servicio de campañas para acceder a la DB
  ) {}

  // --- MEMORIA RAM ---
  // Guardamos las campañas activas y sus keywords aquí
  private activeCampaigns: CampaignKeywords[] = [];

  onModuleInit() {
    this.updateCampaignsCache();
    this.connectToRelay();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleKeywordsSinking() {
    console.log('Sincronizando keywords de campañas activas desde la DB...');
    await this.updateCampaignsCache();
  }

  private async updateCampaignsCache() {
    try {
      const activeCampaignsFromDB = await this.campaignsService.findActive();

      // Almacenamos en memoria RAM normalizando las keywords a minúsculas
      this.activeCampaigns = activeCampaignsFromDB.map(c => ({
        id: c.id,
        name: c.name,
        keywords: c.keywords.map(kw => kw.toLowerCase())
      }));

      console.log(`Caché actualizada. ${this.activeCampaigns.length} campañas activas en memoria RAM.`);
    } catch (error) {
      console.error('Error al actualizar las keywords de la DB:', error);
    }
  }

  private connectToRelay() {
    this.ws = new WebSocket(this.relayUrl);

    this.ws.on('open', () => {
      console.log(`\n Connected to Nostr Relay: ${this.relayUrl}`);
      
      // Una vez conectados, podemos suscribirnos a eventos globales
      this.subscribeToEvents();
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      this.handleRelayMessage(data);
    });

    this.ws.on('error', (error) => {
      console.error('Error en el Relay de Nostr:', error);
    });

    this.ws.on('close', () => {
      console.log('Conexión cerrada con el relay. Reintentando en 5s...');
      setTimeout(() => this.connectToRelay(), 5000); // Auto-reconexión
    });
  }

  // Estructura oficial de Nostr para suscribirse (REQ)
  private subscribeToEvents() {
    const subscriptionId = 'mi-suscripcion-nestjs';
    
    // Queremos notas de texto (kind: 1), limitadas a las últimas 5
    const filtro = {
      kinds: [1], 
      limit: 5
    };

    // Formato estricto Nostr: ["REQ", <subscription_id>, <filters>]
    const subscriptionMessage = JSON.stringify(['REQ', subscriptionId, filtro]);
    
    this.ws.send(subscriptionMessage);
    console.log('Suscripción enviada al relay...');
  }

  // Procesar lo que nos devuelve el Relay
  private handleRelayMessage(data: WebSocket.Data) {
    try {
      const message = JSON.parse(data.toString());
      const messageType = message[0]; // "EVENT", "OK", "EOSE", etc.

      if (messageType === 'EVENT') {
        const event = message[2];
        const content = event.content || ''; // Aseguramos que no sea undefined/null

        // 1. Validación de longitud (descartar si es < 10 o > 1000 caracteres)
        if (content.length < 10 || content.length > 1000) {
          // Opcional: puedes descomentar la siguiente línea si quieres ver en consola qué se está filtrando
          console.log(`[Filtro] Mensaje omitido por longitud (${content.length} caracteres).`);
          return; 
        }

        console.log(`\n[Nuevo Evento de ${event.pubkey.substring(0, 8)}...]:`);
        console.log(`Contenido: ${content}`);

        // 2. Buscar coincidencias con las campañas en memoria RAM
        this.findCampaignMatches(event, content);
      }
    } catch (e) {
      console.error('Error al parsear mensaje del relay', e);
    }
  }

  // --- ALGORITMO DE MATCHING ---
  private findCampaignMatches(event: any, content: string) {
    // Normalizamos el contenido del mensaje a minúsculas para una comparación insensible a mayúsculas
    const lowerCaseContent = content.toLowerCase();

    // Recorremos las campañas en RAM
    for (const campaign of this.activeCampaigns) {
      // Filtramos las keywords de esta campaña que están presentes en el texto
      const foundKeywords = campaign.keywords.filter(keyword => 
        lowerCaseContent.includes(keyword)
      );

      // Si encontramos al menos una keyword, procesamos el match para esta campaña
      if (foundKeywords.length > 0) {
        console.log(`\n[Match Encontrado] Campaña: ${campaign.name} (ID: ${campaign.id})`);
        console.log(`Keywords encontradas: ${foundKeywords.join(', ')}`);
        console.log(`Evento ID: ${event.id}`);
        console.log(`Publicador: ${event.pubkey.substring(0, 8)}...`);
        console.log(`Contenido del evento: ${content}`);
      }
    }
  }

  // Método para publicar tus propias notas desde cualquier parte de tu app
  public enviarEvento(signedEvent: any) {
    // Formato estricto Nostr para publicar: ["EVENT", <event_object>]
    const message = JSON.stringify(['EVENT', signedEvent]);
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      console.error('No se pudo enviar, el socket no está abierto');
    }
  }

  onModuleDestroy() {
    if (this.ws) this.ws.close();
  }
}