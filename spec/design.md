# Especificación Técnica del Sistema: Nostr Ads Platform MVP

## 1. Arquitectura del Sistema

El sistema utiliza un patrón de **Arquitectura Dirigida por Eventos (EDA)** dentro de un **Monolito Modular**.

Este enfoque permite separar la ingesta masiva de datos en tiempo real de los procesos asíncronos pesados, garantizando:

- Escalabilidad.
- Bajo costo operativo.
- Separación clara de responsabilidades.
- Facilidad de mantenimiento.

---

# Flujo de Datos (Pipeline de Impacto)

## 1. Ingesta (WebSocket)

El sistema escucha un Relay de Nostr y filtra notas de texto:

- Tipo de evento: `kind: 1`.
- Utiliza una lista de keywords sincronizada periódicamente en memoria RAM.
- Solo procesa eventos que coincidan con campañas activas.

---

## 2. Filtro Local (Heurística)

Antes de enviar eventos al procesamiento pesado:

1. Se descartan mensajes demasiado cortos o demasiado largos. Menos de 10 caracteres o mas de 1000 caracteres
2. Se valida contra la base de datos si el usuario (`pubkey`) ya recibió un impacto de esa campaña.

Objetivo:

- Evitar spam.
- Reducir costos de procesamiento.
- Evitar múltiples recompensas al mismo usuario.

---

## 3. Procesamiento Asíncrono (Colas)

Los eventos válidos se envían a una cola: Redis + BullMQ

Un worker independiente procesa los eventos evitando bloquear el listener principal.

---

## 4. Análisis mediante LLM

El worker envía:

- Contenido del post.
- Contexto de la campaña.
- Información del producto.

La IA determina si existe intención real del usuario relacionada con el producto.

Ejemplo:

Usuario:
"Estoy buscando una wallet Bitcoin segura"

Campaña:
"Promoción de wallet Bitcoin"

Resultado:
MATCH

---

## 5. Ejecución Atómica

Si el LLM aprueba el impacto:

1. Se publica un comentario promocional en Nostr.
2. El comentario es firmado por la identidad de la plataforma.
3. Se procesa el Zap mediante NWC.
4. Se registra el impacto en PostgreSQL.

La URL NWC se desencripta únicamente en memoria durante la operación.

---

# 2. Stack Tecnológico

| Capa | Tecnología | Justificación |
|---|---|---|
| Backend / API | Node.js + NestJS (TypeScript) | Modularidad estricta y excelente manejo asíncrono para WebSockets y tareas concurrentes. |
| Base de Datos | PostgreSQL | Persistencia relacional, transacciones ACID y soporte nativo para arrays. |
| Caché y Colas | Redis + BullMQ | Delegación de procesos pesados como IA y pagos. |
| Protocolo Nostr | nostr-tools + @nostr-dev-kit/ndk | Manejo de eventos, firmas criptográficas y conexiones NWC. |
| Inteligencia Artificial | DeepSeek-V3 / OpenAI GPT-4o-mini | Modelos económicos con baja latencia y buen razonamiento contextual. |
| Frontend Dashboard | Next.js + Tailwind CSS | Desarrollo rápido de interfaces modernas. |

---

# 3. Diseño del Código en NestJS

La estructura está basada en módulos de dominio, aislando responsabilidades y protegiendo componentes sensibles como las llaves criptográficas.

```text
nostr-ads-backend/
│
├── src/
│   │
│   ├── main.ts
│   ├── app.module.ts
│   │
│   ├── common/
│   │   └── crypto/
│   │       └── aes-gcm.util.ts
│   │           # Encriptación / desencriptación de NWC
│   │
│   └── modules/
│       │
│       ├── companies/
│       │   ├── companies.module.ts
│       │   ├── companies.controller.ts
│       │   └── companies.service.ts
│       │
│       ├── campaigns/
│       │   ├── campaigns.module.ts
│       │   ├── campaigns.controller.ts
│       │   └── campaigns.service.ts
│       │       # Gestión de campañas y sincronización RAM
│       │
│       ├── nostr/
│       │   ├── nostr.module.ts
│       │   ├── nostr.listener.ts
│       │   │   # Escucha relay y envía eventos a cola
│       │   │
│       │   └── nostr.publisher.ts
│       │       # Firma y publica comentarios
│       │
│       ├── llm/
│       │   ├── llm.module.ts
│       │   └── llm.service.ts
│       │
│       ├── wallet/
│       │   ├── wallet.module.ts
│       │   └── wallet.service.ts
│       │       # Ejecuta Zaps mediante NWC
│       │
│       └── queues/
│           ├── queues.module.ts
│           └── processors/
│               └── campaign-impact.processor.ts
│                   # Flujo:
│                   # Filtro -> LLM -> Nostr -> Wallet
```
---

# 4. Diseño de Base de Datos PostgreSQL

El esquema está diseñado para ser simple pero robusto.

Características:

- Almacenamiento seguro de información sensible.
- Auditoría completa de impactos.
- Optimización para evitar spam.
- Consultas rápidas mediante índices.

---

# Tabla: companies

Almacena las empresas clientes.

| Columna | Tipo | Restricciones | Descripción |
|-|-|-|-|
| id | UUID | Primary Key | Identificador único |
| name | VARCHAR | Not Null | Nombre comercial |
| email | VARCHAR | Unique, Not Null | Correo de acceso |
| password_hash | VARCHAR | Not Null | Contraseña cifrada con bcrypt |
| created_at | TIMESTAMP | Default NOW() | Fecha de registro |

---

# Tabla: campaigns

Gestiona las campañas publicitarias.

| Columna | Tipo | Restricciones | Descripción |
|-|-|-|-|
| id | UUID | Primary Key | Identificador único |
| company_id | UUID | Foreign Key | Empresa propietaria |
| name | VARCHAR | Not Null | Nombre de campaña |
| description | TEXT | Not Null | Contexto para el LLM |
| keywords | TEXT[] | Not Null | Palabras clave de búsqueda |
| nwc_url_encrypted | VARCHAR | Not Null | URL NWC cifrada AES-256 |
| sats_per_impact | INTEGER | Not Null | Presupuesto por impacto |
| status | VARCHAR | Enum | active, paused, cancelled, completed |
| created_at | TIMESTAMP | Default NOW() | Fecha creación |
| ends_at | TIMESTAMP | Not Null | Fecha límite de campaña |

---

# Tabla: impacts

Registro histórico de cada impacto generado.

Esta tabla es crítica para:

- Auditoría.
- Control de pagos.
- Evitar múltiples impactos al mismo usuario.

| Columna | Tipo | Restricciones | Descripción |
|-|-|-|-|
| id | UUID | Primary Key | Identificador del impacto |
| campaign_id | UUID | Foreign Key | Campaña asociada |
| target_pubkey | VARCHAR | Not Null | Usuario impactado en Nostr |
| target_event_id | VARCHAR | Unique, Not Null | ID del evento original |
| status | VARCHAR | Enum | full_success / comment_only |
| sats_charged | INTEGER | Not Null | Total cobrado |
| platform_fee | INTEGER | Not Null | Ganancia plataforma |
| created_at | TIMESTAMP | Default NOW() | Fecha del impacto |

---

# Estados de Impacto

## full_success

Indica que:

- El comentario fue publicado.
- El Zap fue enviado correctamente.

---

## comment_only

Indica que:

- El comentario fue publicado.
- El Zap no pudo ejecutarse.

Ejemplo:

- Usuario sin Lightning Address válido.

---

# Relaciones del Modelo

## Company → Campaigns

Relación:

Una empresa puede tener múltiples campañas.

---

## Campaign → Impacts

Relación:

Una campaña genera múltiples impactos durante su ejecución.

---

# Índices Importantes

Para validar rápidamente si un usuario ya fue impactado:

```sql
CREATE INDEX idx_impacts_campaign_pubkey
ON impacts(campaign_id, target_pubkey);

Esta consulta debe resolverse en tiempo casi constante durante la fase de filtro local.