# Nostr Marketing

Platform for managing promotional campaigns on Nostr. The React frontend lets users create campaigns and view their impacts; the NestJS API stores data in PostgreSQL, uses Redis/BullMQ for asynchronous jobs, and integrates with Nostr, NWC, and OpenRouter.

## Architecture

- `frontend`: React and Vite.
- `backend`: NestJS API, TypeORM, PostgreSQL, Redis/BullMQ, and Nostr/NWC/OpenRouter integrations.
- `docker-compose.yml`: complete local environment with hot reload.
- `DEPLOY_RAILWAY.md`: Railway deployment guide.

## Requirements

- Docker Desktop with Docker Compose v2.
- When using WSL, enable the distribution integration in Docker Desktop.
- **Development** credentials for Nostr, NWC, and OpenRouter when testing real flows.

## Local configuration

1. Create the local environment file:

   ```bash
   cp backend/.env.example backend/.env
   ```

2. Complete `backend/.env`. Define at least a random 64-character hexadecimal key for `ENCRYPTION_KEY`, a long `JWT_SECRET`, and a database password. Use these local connectivity values:

   | Variable | Value in `backend/.env` | Effective value with `docker compose` | Purpose |
   | --- | --- | --- | --- |
   | `DB_HOST` | `localhost` | `postgres_db` | API to PostgreSQL |
   | `REDIS_HOST` | `localhost` | `redis_cache` | API to Redis/BullMQ |
   | `REDIS_USERNAME` | empty | empty | Local Redis does not use a username |
   | `REDIS_PASSWORD` | empty | empty | Local Redis does not use a password |

   `localhost` lets you run the API directly with `npm run start:dev`, using the ports published by Compose. When running `docker compose`, both `*_HOST` variables are automatically replaced with the internal network service names. For a protected external Redis instance, set `REDIS_USERNAME` and `REDIS_PASSWORD`; Railway configures them through managed Redis references.

3. To use real integrations, configure `PLATFORM_NSEC`, its corresponding public key `PLATFORM_NPUB`, `PLATFORM_NWC_URL`, and, when applicable, `OPENROUTER_API_KEY`. Use only development secrets, Nostr identity, wallet, and balance. Never reuse values configured for production.

The variables exist in both environments, but their values must differ: production values are defined exclusively in Railway, while local values remain in `backend/.env`, which Git ignores.

## Run in development

```bash
docker compose up --build
```

The frontend is available at http://localhost:5173 and the API at http://localhost:3000. PostgreSQL and Redis are exposed on ports `5432` and `6379`. The API waits for both dependencies to be healthy and runs pending migrations at startup.

Frontend and backend source code is mounted into the containers, so Vite and Nest reload automatically after changes. To stop the environment, run `docker compose down`. To also remove local databases and start over, run `docker compose down -v`.

## Quality and tests

With dependencies installed in each package, the main commands are:

```bash
cd backend && npm test && npm run build
cd frontend && npm run lint && npm run build
```

Before testing real campaigns, validate with a minimum-value campaign and development credentials. Integrations can publish to the relay, consume OpenRouter, and create NWC payments; control their balances and limits.

## Production

Dockerfiles build production images by default: a compiled backend and an nginx-served frontend. Railway uses those images, not Compose's development target. Follow the [Railway guide](DEPLOY_RAILWAY.md) and create production-only secrets.
