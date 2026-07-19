# Nostr Marketing Backend

Backend de campañas promocionales para Nostr, construido con NestJS y TypeScript. Las empresas crean campañas asociadas a una wallet mediante Nostr Wallet Connect (NWC); el servicio escucha notas públicas, detecta coincidencias, las evalúa y, cuando corresponden, publica una respuesta promocional y envía un zap.

## Capacidades actuales

- Registro de empresas e inicio de sesión con JWT.
- Creación y administración de campañas propias: consulta, edición, pausa, reanudación y cancelación.
- Validación de saldo de la wallet NWC y cifrado AES-256 de su URL antes de persistirla.
- Duración máxima de 30 días; una tarea programada marca como `completed` las campañas vencidas.
- Conexión a un relay Nostr, filtrado por palabras clave y cola BullMQ respaldada por Redis.
- Evaluación de intención con OpenRouter. Si `OPENROUTER_API_KEY` no está configurada, se usa un resultado seguro sin coincidencia.
- Comentario promocional, zap LNURL/NWC y registro del impacto con su estado, costo y comisión de plataforma.
- Bull Board se encuentra deshabilitado por defecto; puede habilitarse de forma explícita y autenticada para observar `nostr-matches`.

## Arquitectura

1. La API NestJS guarda empresas, campañas e impactos en PostgreSQL mediante TypeORM.
2. `NostrService` mantiene la suscripción al relay y refresca cada minuto la caché de campañas activas.
3. Las coincidencias se encolan en Redis/BullMQ; el consumidor usa el LLM para decidir si hay interés comercial.
4. Un impacto aprobado verifica de nuevo que la campaña esté activa, publica la nota, intenta el zap y guarda el resultado.

Las URLs NWC se almacenan cifradas, pero la aplicación procesa credenciales de pago y publica en Nostr. Proteja la infraestructura y los logs. Bull Board devuelve `404` mientras está deshabilitado y requiere autenticación HTTP Basic cuando se habilita.

## Requisitos

- Node.js 24 (la imagen Docker usa `node:24-alpine`).
- npm.
- PostgreSQL 16 y Redis 7 para ejecución local, o Docker Compose para levantar ambos servicios.
- Una identidad Nostr de plataforma (`PLATFORM_NSEC` y `PLATFORM_NPUB`) y un relay accesible para operar el listener.
- Una URL NWC válida con saldo para crear campañas. `OPENROUTER_API_KEY` es opcional, pero sin ella ningún match será aprobado.

## Configuración

Copie el ejemplo y complete las variables en un archivo local, que no debe versionarse:

```powershell
Copy-Item .env.example .env
```

En macOS/Linux:

```bash
cp .env.example .env
```

`.env.example` contiene solo nombres, valores de desarrollo y marcadores; reemplace los valores locales antes de desplegar. Nunca pegue una NSEC, una URL NWC, una clave de OpenRouter ni una clave AES en el README, el control de versiones o los logs.

| Variable                                                      | Uso                                                                                                                                                            |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                        | Puerto HTTP de la API (por defecto `3000`).                                                                                                                    |
| `BULL_BOARD_ENABLED`                                          | Manténgalo en `false` (valor recomendado). Solo `true` habilita el panel `/queues`.                                                                            |
| `BULL_BOARD_USERNAME`, `BULL_BOARD_PASSWORD`                  | Credenciales obligatorias cuando Bull Board está habilitado; use valores secretos y un proxy TLS/red privada.                                                  |
| `JWT_SECRET`                                                  | Secreto obligatorio usado para firmar y verificar tokens JWT; use un valor aleatorio distinto por entorno.                                                     |
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` | Conexión a PostgreSQL. En Docker use el host `postgres_db`; en local, normalmente `localhost`.                                                                 |
| `REDIS_HOST`, `REDIS_PORT`                                    | Conexión a Redis. En Docker use `redis_cache`; en local, normalmente `localhost`.                                                                              |
| `ENCRYPTION_KEY`                                              | Clave AES-256: exactamente 64 caracteres hexadecimales. Genérela, por ejemplo, con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`                      | Credencial y modelo de OpenRouter; la clave es opcional.                                                                                                       |
| `PLATFORM_NSEC`, `PLATFORM_NPUB`                              | Identidad privada y pública de la plataforma Nostr. Admiten formato Nostr o hex de 64 caracteres.                                                              |
| `NOSTR_RELAY_URL`                                             | URL WebSocket del relay que se escucha y se referencia en las respuestas como relay de origen.                                                                 |
| `NOSTR_ZAP_RELAY_URL`                                         | Relay público anunciado en las solicitudes NIP-57; configúrelo si el relay de escucha es privado o inaccesible para el servidor LNURL.                         |
| `NOSTR_PUBLISH_RELAY_URL`                                     | Relay donde se publican las respuestas promocionales. Si se omite, usa `NOSTR_RELAY_URL`. Use un relay público cuando los clientes deban ver las respuestas.  |
| `NWC_FORCE_NIP04`                                              | Déjelo en `false`. Use `true` solo con wallets NWC que no responden al evento service-info NIP-47 pero requieren cifrado NIP-04.                              |

> Antes de producción, externalice y rote las credenciales de infraestructura y las claves de la aplicación. El JWT debe gestionarse como secreto de despliegue, no como un valor compartido en el código o la documentación.

## Arranque con Docker

1. Prepare `.env` a partir de `.env.example` y conserve `DB_HOST=postgres_db` y `REDIS_HOST=redis_cache`.
2. Inicie las dependencias y espere a que PostgreSQL acepte conexiones:

   ```bash
   docker compose up -d postgres_db redis_cache
   docker compose logs -f postgres_db
   ```

3. En otra terminal, inicie la API:

   ```bash
   docker compose up --build api
   ```

La API queda en `http://localhost:3000`. PostgreSQL y Redis solo se exponen en la red interna de Docker; para administrarlos use `docker compose exec`, no puertos de host. Las migraciones pendientes se ejecutan al iniciar. Para detener los servicios, use `docker compose down`; los volúmenes nombrados conservan los datos. Use `docker compose down -v` solo si desea eliminar explícitamente las bases de datos locales.

### Acceso seguro a Bull Board

Bull Board está deshabilitado por defecto. Para habilitarlo temporalmente, configure valores secretos distintos de los ejemplos y sitúe la API detrás de TLS y una red privada o un proxy con control de acceso:

```dotenv
BULL_BOARD_ENABLED=true
BULL_BOARD_USERNAME=<usuario-administrador>
BULL_BOARD_PASSWORD=<contrasena-larga-y-aleatoria>
```

No exponga `/queues` directamente a Internet ni reutilice las credenciales de empresas. Al volver a una operación normal, establezca `BULL_BOARD_ENABLED=false` y reinicie la API.

## Arranque local

1. Levante PostgreSQL y Redis y cree una base de datos cuyo nombre coincida con `DB_NAME`.
2. En `.env`, configure `DB_HOST=localhost` y `REDIS_HOST=localhost` (o los hosts reales).
3. Instale dependencias y ejecute la API:

   ```bash
   npm ci
   npm run migration:run
   npm run start:dev
   ```

La aplicación también intenta ejecutar migraciones al arrancar. Ejecutarlas de forma explícita permite detectar problemas de conexión antes de levantar el listener de Nostr.

## Migraciones

Las migraciones TypeORM están en `src/migrations/` y el datasource CLI en `src/data-source.ts`.

```bash
# aplicar las pendientes
npm run migration:run

# revertir la última migración aplicada
npm run migration:revert

# generar una migración después de modificar entidades
npm run migration:generate --name=NombreDescriptivo
```

Los comandos requieren las variables de PostgreSQL configuradas y una base de datos alcanzable. Revise la migración generada antes de aplicarla en cualquier entorno compartido.

## API principal

La validación global elimina propiedades no declaradas y rechaza payloads con campos adicionales. Las fechas se envían en ISO 8601.

### Autenticación

| Método y ruta      | Descripción                                               |
| ------------------ | --------------------------------------------------------- |
| `POST /companies`  | Crea una empresa con `name`, `email` y `password`.        |
| `POST /auth/login` | Recibe `email` y `password`; responde con `access_token`. |

El registro de empresas y el inicio de sesión son públicos. Las consultas, actualizaciones y eliminaciones de empresas requieren JWT y solo permiten operar sobre la propia empresa; las respuestas nunca incluyen hashes de contraseñas.

Ejemplo de inicio de sesión:

```json
{
  "email": "empresa@example.com",
  "password": "una-contrasena-segura"
}
```

Incluya el token obtenido en las operaciones de campañas:

```text
Authorization: Bearer <access_token>
```

### Campañas

Todas las rutas de campañas requieren JWT y solo permiten operar sobre campañas de la empresa autenticada.

| Método y ruta                 | Descripción                                                          |
| ----------------------------- | -------------------------------------------------------------------- |
| `POST /campaigns`             | Crea una campaña activa tras comprobar la wallet y cifrar `nwcUrl`.  |
| `GET /campaigns`              | Lista las campañas de la empresa autenticada.                        |
| `GET /campaigns/:id`          | Obtiene una campaña propia.                                          |
| `PATCH /campaigns/:id`        | Actualiza los campos proporcionados de una campaña activa o pausada. |
| `PATCH /campaigns/:id/pause`  | Pausa una campaña activa.                                            |
| `PATCH /campaigns/:id/resume` | Reanuda una campaña pausada.                                         |
| `DELETE /campaigns/:id`       | Cancela una campaña; no la borra físicamente.                        |

Payload de creación:

```json
{
  "name": "Campaña de ejemplo",
  "productDescription": "Descripción concisa del producto o servicio",
  "keywords": ["nostr", "bitcoin"],
  "nwcUrl": "<url-nwc-de-la-wallet>",
  "satsPerImpact": 21,
  "endsAt": "2026-08-01T00:00:00.000Z"
}
```

`endsAt` debe ser futura y no superar 30 días desde la activación. Las campañas canceladas o completadas no se pueden editar; una campaña vencida se cierra automáticamente.

## Calidad y pruebas

```bash
# compilar TypeScript
npm run build

# tests unitarios
npm test -- --runInBand

# cobertura
npm run test:cov

# formato y lint
npm run format
npm run lint

# aplicar automáticamente las correcciones de lint seguras
npm run lint:fix
```

### Prueba E2E

```bash
npm ci
docker compose -f docker-compose.e2e.yml up -d --wait
npm run test:e2e
docker compose -f docker-compose.e2e.yml down
```

La prueba importa el `AppModule` real y comprueba conectividad con PostgreSQL, Redis y `GET /`. `docker-compose.e2e.yml` levanta servicios aislados en los puertos `55432` y `56379`; `test/e2e.setup.ts` define credenciales y claves de prueba. El relay Nostr, NWC y el LLM se simulan, por lo que la suite no publica eventos ni realiza pagos externos.

`docker compose ... down` detiene y elimina solo los contenedores E2E. No use `-v` salvo que quiera eliminar expresamente sus volúmenes de prueba.
