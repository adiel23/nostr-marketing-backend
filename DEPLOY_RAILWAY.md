# Despliegue en Railway

Esta aplicación se publica con cuatro servicios: `api`, `frontend`, PostgreSQL y Redis.
No subas nunca `backend/.env` ni pegues claves reales en GitHub, tickets o capturas.

## 1. Preparar las claves

Antes de publicar, revoca las credenciales Nostr y NWC utilizadas durante el desarrollo y crea otras para producción con un saldo inicial limitado. Genera también una nueva clave AES de 32 bytes (64 caracteres hexadecimales) y un `JWT_SECRET` largo y aleatorio. Copia únicamente valores nuevos al panel de Railway.

## 2. Crear los servicios

1. En Railway, crea un proyecto y conecta el repositorio GitHub.
2. Añade los servicios **PostgreSQL** y **Redis** desde el botón **New**.
3. Añade un servicio desde el mismo repositorio para la API. En sus ajustes establece `Root Directory` como `backend`; Railway detectará su `Dockerfile`.
4. Añade otro servicio desde el mismo repositorio para el frontend, con `Root Directory` igual a `frontend`.
5. Genera un dominio público para cada uno. Conserva el dominio de la API para el paso siguiente.

## 3. Variables de la API

En el servicio `api`, añade estas variables. Las referencias se eligen desde **Add Variable Reference** para no copiar contraseñas:

| Variable | Valor |
| --- | --- |
| `DB_HOST` | referencia a `Postgres.PGHOST` |
| `DB_PORT` | referencia a `Postgres.PGPORT` |
| `DB_USERNAME` | referencia a `Postgres.PGUSER` |
| `DB_PASSWORD` | referencia a `Postgres.PGPASSWORD` |
| `DB_NAME` | referencia a `Postgres.PGDATABASE` |
| `REDIS_HOST` | referencia a `Redis.REDISHOST` |
| `REDIS_PORT` | referencia a `Redis.REDISPORT` |
| `REDIS_USERNAME` | referencia a `Redis.REDISUSER` |
| `REDIS_PASSWORD` | referencia a `Redis.REDISPASSWORD` |
| `JWT_SECRET` | nuevo secreto aleatorio largo |
| `ENCRYPTION_KEY` | nueva clave AES hexadecimal de 64 caracteres |
| `PLATFORM_NSEC`, `PLATFORM_NPUB`, `PLATFORM_NWC_URL` | nuevas credenciales de producción |
| `NOSTR_RELAY_URL` | `wss://relay.damus.io` o el relay elegido |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | clave y modelo de producción |
| `FRONTEND_URL` | dominio HTTPS público del frontend, sin `/` final |

Railway proporciona `PORT` automáticamente. La API ejecuta migraciones al arrancar.

## 4. Variable y despliegue del frontend

En `frontend` configura el argumento de compilación `VITE_API_URL` con el dominio HTTPS de la API, sin `/` final, y vuelve a desplegar. Para el contenedor nginx configura `PORT=8080` si Railway lo solicita.

Cada cambio de `VITE_API_URL` requiere recompilar el frontend porque Vite incorpora este valor en los archivos estáticos.

## 5. Comprobación antes de difundir el enlace

1. Abre el dominio del frontend desde un teléfono por datos móviles.
2. Registra una cuenta, inicia sesión y crea una campaña de importe muy bajo.
3. Confirma en los logs de `api` que las migraciones, Redis y Nostr se conectaron sin errores.
4. Realiza un único pago controlado y confirma el registro de impacto y pago en la interfaz.
5. Reinicia solamente la API desde Railway y verifica que las campañas siguen existiendo.

Configura un límite de gasto en Railway y otro en OpenRouter antes de compartir el enlace públicamente.
