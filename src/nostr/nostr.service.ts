import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import WebSocket from 'ws';

@Injectable()
export class NostrService implements OnModuleInit, OnModuleDestroy {
  private ws!: WebSocket;
  // Usamos un relay público conocido para pruebas
  private readonly relayUrl = 'wss://relay.damus.io'; 

  onModuleInit() {
    this.connectToRelay();
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
        console.log(`\n[Nuevo Evento de ${event.pubkey.substring(0, 8)}...]:`);
        console.log(`Contenido: ${event.content}`);
      }
    } catch (e) {
      console.error('Error al parsear mensaje del relay', e);
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