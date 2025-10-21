import pkg from 'pg';
import dotenv from 'dotenv';
import bootstrapDatabase from './bootstrap.js';

dotenv.config();

const { Pool } = pkg;

let poolPromise;

const RETRYABLE_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH'
]);

const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 12000];

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const shouldRetry = (error) => {
  if (!error) {
    return false;
  }

  const code = error.code || error.errno;
  if (code && RETRYABLE_CODES.has(code)) {
    return true;
  }

  const message = typeof error.message === 'string' ? error.message : '';
  return message.includes('getaddrinfo');
};

const waitForPool = async (pool) => {
  let attempt = 0;
  let lastError;

  while (attempt <= RETRY_DELAYS_MS.length) {
    try {
      await pool.query('SELECT 1');
      if (attempt > 0) {
        console.log(`Conexión a PostgreSQL establecida tras ${attempt + 1} intentos`);
      }
      return;
    } catch (error) {
      lastError = error;

      if (shouldRetry(error) && attempt < RETRY_DELAYS_MS.length) {
        const wait = RETRY_DELAYS_MS[attempt];
        console.warn(`PostgreSQL no disponible (${error.code || error.message}). Reintento en ${wait}ms`);
        await sleep(wait);
        attempt += 1;
        continue;
      }

      throw error;
    }
  }

  throw lastError;
};

const createPool = async () => {
  await bootstrapDatabase();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    user: process.env.DB_USER || 'Horizonst_user',
    password: process.env.DB_PASSWORD || '20025@BLELoRa',
    database: process.env.DB_NAME || 'horixonst',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
    process.exit(-1);
  });

  await waitForPool(pool);

  return pool;
};

const ensurePool = () => {
  if (!poolPromise) {
    poolPromise = createPool();
  }

  return poolPromise;
};

export const query = async (text, params) => {
  const pool = await ensurePool();
  try {
    return await pool.query(text, params);
  } catch (error) {
    console.error('Error al ejecutar consulta SQL', {
      sql: text,
      params,
      position: error?.position,
      code: error?.code
    });
    throw error;
  }
};

export const getClient = async () => {
  const pool = await ensurePool();
  return pool.connect();
};

export default ensurePool;
