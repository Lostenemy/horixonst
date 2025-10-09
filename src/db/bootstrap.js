import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pkg;

let bootstrapped = false;

const quoteIdentifier = (value) => value.replace(/"/g, '""');

const withIdentifier = (value) => `"${quoteIdentifier(value)}"`;

export default async function bootstrapDatabase() {
  if (bootstrapped) {
    return;
  }

  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432;
  const rootUser = process.env.DB_ROOT_USER || process.env.POSTGRES_USER || 'postgres';
  const rootPassword = process.env.DB_ROOT_PASSWORD || process.env.POSTGRES_PASSWORD || '';
  const rootDatabase = process.env.DB_ROOT_DATABASE || 'postgres';
  const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;

  const targetUser = process.env.DB_USER || 'Horizonst_user';
  const targetPassword = process.env.DB_PASSWORD || '20025@BLELoRa';
  const targetDatabase = process.env.DB_NAME || 'horixonst';

  const client = new Client({
    host,
    port,
    user: rootUser,
    password: rootPassword,
    database: rootDatabase,
    ssl
  });

  try {
    await client.connect();

    const roleExists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [targetUser]);

    if (roleExists.rowCount === 0) {
      await client.query(`CREATE ROLE ${withIdentifier(targetUser)} WITH LOGIN PASSWORD $1`, [targetPassword]);
      console.log(`Created database role ${targetUser}`);
    } else if (targetPassword) {
      await client.query(`ALTER ROLE ${withIdentifier(targetUser)} WITH LOGIN PASSWORD $1`, [targetPassword]);
    }

    const dbExists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDatabase]);

    if (dbExists.rowCount === 0) {
      await client.query(`CREATE DATABASE ${withIdentifier(targetDatabase)} OWNER ${withIdentifier(targetUser)}`);
      console.log(`Created database ${targetDatabase}`);
    } else {
      await client.query(`ALTER DATABASE ${withIdentifier(targetDatabase)} OWNER TO ${withIdentifier(targetUser)}`);
    }

    await client.query(`GRANT ALL PRIVILEGES ON DATABASE ${withIdentifier(targetDatabase)} TO ${withIdentifier(targetUser)}`);

    bootstrapped = true;
  } catch (error) {
    console.error('Failed to bootstrap database', error);
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}
