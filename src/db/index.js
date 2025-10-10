import pkg from 'pg';
import dotenv from 'dotenv';
import bootstrapDatabase from './bootstrap.js';

dotenv.config();

const { Pool } = pkg;

let poolPromise;

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
  return pool.query(text, params);
};

export const getClient = async () => {
  const pool = await ensurePool();
  return pool.connect();
};

export default ensurePool;
