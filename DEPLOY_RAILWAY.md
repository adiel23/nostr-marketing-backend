# Railway Deployment

This application is deployed as four services: `api`, `frontend`, PostgreSQL, and Redis.
Never commit `backend/.env` or paste real secrets into GitHub, tickets, or screenshots.

## 1. Prepare secrets

Before deploying, revoke the Nostr and NWC credentials used during development and create separate production credentials with a limited initial balance. Also generate a new 32-byte AES key (64 hexadecimal characters) and a long random `JWT_SECRET`. Copy only new values into the Railway dashboard.

## 2. Create services

1. In Railway, create a project and connect the GitHub repository.
2. Add **PostgreSQL** and **Redis** services from the **New** button.
3. Add a service from the same repository for the API. In its settings, set `Root Directory` to `backend`; Railway will detect its `Dockerfile`.
4. Add another service from the same repository for the frontend, with `Root Directory` set to `frontend`.
5. Generate a public domain for each service. Keep the API domain for the next step.

## 3. API variables

Add these variables to the `api` service. Choose references through **Add Variable Reference** to avoid copying passwords:

| Variable | Value |
| --- | --- |
| `DB_HOST` | reference to `Postgres.PGHOST` |
| `DB_PORT` | reference to `Postgres.PGPORT` |
| `DB_USERNAME` | reference to `Postgres.PGUSER` |
| `DB_PASSWORD` | reference to `Postgres.PGPASSWORD` |
| `DB_NAME` | reference to `Postgres.PGDATABASE` |
| `REDIS_HOST` | reference to `Redis.REDISHOST` |
| `REDIS_PORT` | reference to `Redis.REDISPORT` |
| `REDIS_USERNAME` | reference to `Redis.REDISUSER` |
| `REDIS_PASSWORD` | reference to `Redis.REDISPASSWORD` |
| `JWT_SECRET` | new long random secret |
| `ENCRYPTION_KEY` | new 64-character hexadecimal AES key |
| `PLATFORM_NSEC`, `PLATFORM_NPUB`, `PLATFORM_NWC_URL` | new production credentials |
| `NOSTR_RELAY_URL` | `wss://relay.damus.io` or the chosen relay |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | production API key and model |
| `FRONTEND_URL` | public HTTPS frontend domain, without a trailing `/` |

Railway provides `PORT` automatically. The API runs migrations at startup.

## 4. Frontend variable and deployment

In `frontend`, set `VITE_API_URL` to the API HTTPS domain, without a trailing `/`, then redeploy. The container writes it at startup, so it does not depend on Railway injecting it during the build. Set `PORT=8080` for the nginx container if Railway requires it.

Every `VITE_API_URL` change requires redeploying the frontend to restart its container.

## 5. Check before sharing the link

1. Open the frontend domain from a phone using mobile data.
2. Register an account, sign in, and create a very-low-value campaign.
3. Confirm in the `api` logs that migrations, Redis, and Nostr connected without errors.
4. Make one controlled payment and confirm the impact and payment records in the interface.
5. Restart only the API in Railway and verify that campaigns persist.

Set a spending limit in Railway and another in OpenRouter before sharing the public link.
