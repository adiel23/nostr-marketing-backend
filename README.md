# Nostr Marketing

Plataforma para administrar campañas promocionales en Nostr. El frontend React permite crear campañas y ver sus impactos; la API NestJS guarda los datos en PostgreSQL, usa Redis/BullMQ para trabajos asíncronos y se integra con Nostr, NWC y OpenRouter.

## Arquitectura

- `frontend`: React y Vite.
- `backend`: API NestJS, TypeORM, PostgreSQL, Redis/BullMQ e integraciones Nostr/NWC/OpenRouter.
- `docker-compose.yml`: entorno local completo con recarga automática.
- `DEPLOY_RAILWAY.md`: guía de publicación en Railway.

## Requisitos

- Docker Desktop con Docker Compose v2.
- En WSL, activar la integración de la distribución en Docker Desktop.
- Credenciales **de desarrollo** para Nostr, NWC y OpenRouter si se probarán esos flujos reales.

## Configuración local

1. Crea el archivo local de variables:

   ```bash
   cp backend/.env.example backend/.env
   ```

2. Completa `backend/.env`. Define al menos una clave hexadecimal aleatoria de 64 caracteres para `ENCRYPTION_KEY`, un `JWT_SECRET` largo y una contraseña de base de datos. Usa estos valores de conectividad local:

   | Variable | Valor en `backend/.env` | Valor efectivo con `docker compose` | Uso |
   | --- | --- | --- | --- |
   | `DB_HOST` | `localhost` | `postgres_db` | API a PostgreSQL |
   | `REDIS_HOST` | `localhost` | `redis_cache` | API a Redis/BullMQ |
   | `REDIS_USERNAME` | vacío | vacío | Redis local no usa usuario |
   | `REDIS_PASSWORD` | vacío | vacío | Redis local no usa contraseña |

   `localhost` permite ejecutar la API directamente con `npm run start:dev`, usando los puertos publicados por Compose. Al ejecutar `docker compose`, las dos variables `*_HOST` se sustituyen automáticamente por los nombres de servicio de la red interna. Para un Redis externo protegido, rellena `REDIS_USERNAME` y `REDIS_PASSWORD`; en Railway se configuran mediante referencias al Redis administrado.

3. Para usar las integraciones reales, configura `PLATFORM_NSEC`, su clave pública correspondiente `PLATFORM_NPUB`, `PLATFORM_NWC_URL` y, cuando corresponda, `OPENROUTER_API_KEY`. Usa únicamente secretos, identidad Nostr, wallet y saldo de desarrollo. Nunca reutilices los valores configurados en producción.

Las variables existen en ambos entornos, pero sus valores deben ser distintos: los de producción se definen exclusivamente en Railway y los locales permanecen en `backend/.env`, que Git ignora.

## Ejecutar en desarrollo

```bash
docker compose up --build
```

El frontend estará disponible en http://localhost:5173 y la API en http://localhost:3000. PostgreSQL y Redis se exponen en los puertos `5432` y `6379`. La API espera a que ambas dependencias estén saludables y ejecuta las migraciones pendientes al arrancar.

El código de frontend y backend se monta en los contenedores, por lo que Vite y Nest recargan automáticamente al modificarlo. Para detener el entorno usa `docker compose down`. Para eliminar también las bases de datos locales y empezar de cero usa `docker compose down -v`.

## Calidad y pruebas

Con las dependencias instaladas en cada paquete, los comandos principales son:

```bash
cd backend && npm test && npm run build
cd frontend && npm run lint && npm run build
```

Antes de probar campañas reales, valida con una campaña de importe mínimo y credenciales de desarrollo. Las integraciones pueden publicar en el relay, consumir OpenRouter y crear pagos NWC; controla sus fondos y límites.

## Producción

Los Dockerfiles construyen por defecto las imágenes de producción: backend compilado y frontend servido por nginx. Railway usa esas imágenes, no el target de desarrollo de Compose. Sigue [la guía de Railway](DEPLOY_RAILWAY.md) y crea secretos exclusivos de producción.
