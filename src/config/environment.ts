import 'dotenv/config';

function readRequiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} debe estar configurada.`);
  }

  return value;
}

function readPort(name: string, fallback: number): number {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} debe ser un puerto válido entre 1 y 65535.`);
  }

  return port;
}

export const databaseEnvironment = {
  host: process.env.DB_HOST ?? 'localhost',
  port: readPort('DB_PORT', 5432),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

export const redisEnvironment = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: readPort('REDIS_PORT', 6379),
};

export function getJwtSecret(): string {
  return readRequiredEnvironment('JWT_SECRET');
}
