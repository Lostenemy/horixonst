import pkg from 'pg';
import dotenv from 'dotenv';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import format from 'pg-format';

dotenv.config();

const { Client } = pkg;

let bootstrapped = false;

const resolveSchemaPath = () => {
  const configuredPath = process.env.DB_SCHEMA_PATH;

  if (configuredPath && configuredPath.trim().length > 0) {
    const trimmed = configuredPath.trim();
    return path.isAbsolute(trimmed)
      ? trimmed
      : path.resolve(process.cwd(), trimmed);
  }

  const defaultUrl = new URL('../../sql/schema.sql', import.meta.url);
  return fileURLToPath(defaultUrl);
};

const shouldApplySchema = (createdDatabase, missingCoreTables) => {
  const preference = (process.env.DB_BOOTSTRAP_SCHEMA || 'on-create').toLowerCase();

  if (preference === 'never' || preference === 'false') {
    return false;
  }

  if (preference === 'always' || preference === 'true') {
    return true;
  }

  if (preference === 'on-missing') {
    return missingCoreTables;
  }

  return createdDatabase || missingCoreTables;
};

const shouldLogSql = process.env.DEBUG_BOOTSTRAP !== 'false';

const logSql = (sql, params) => {
  if (!shouldLogSql) {
    return;
  }

  console.info('[bootstrap] SQL>', sql, params ?? []);
};

const execute = async (client, sql, params) => {
  logSql(sql, params);

  try {
    return await client.query(sql, params);
  } catch (error) {
    console.error('[bootstrap] Error al ejecutar SQL', {
      sql,
      params,
      position: error?.position,
      code: error?.code
    });
    throw error;
  }
};

const hasMissingCoreTables = async (connectionConfig) => {
  const requiredTables = ['users', 'user_roles'];

  if (requiredTables.length === 0) {
    return false;
  }

  const missingTablesSql = `
    SELECT COUNT(*)::INT AS present
    FROM information_schema.tables
    WHERE table_schema = $1
      AND table_name = ANY($2::text[])`;
  const client = new Client(connectionConfig);

  try {
    await client.connect();
    const { rows } = await execute(client, missingTablesSql, ['public', requiredTables]);

    const present = rows?.[0]?.present ?? 0;
    return present < requiredTables.length;
  } catch (error) {
    console.warn('No se pudo comprobar el estado del esquema, se forzará su aplicación.', error);
    return true;
  } finally {
    await client.end().catch(() => {});
  }
};

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

  let createdDatabase = false;

  try {
    await client.connect();

    const roleExists = await execute(
      client,
      'SELECT 1 FROM pg_roles WHERE rolname = $1',
      [targetUser]
    );

    const hasTargetPassword = typeof targetPassword === 'string' && targetPassword.length > 0;

    if (roleExists.rowCount === 0) {
      const createRoleSql = hasTargetPassword
        ? format('CREATE ROLE %I WITH LOGIN PASSWORD %L', targetUser, targetPassword)
        : format('CREATE ROLE %I WITH LOGIN', targetUser);
      await execute(client, createRoleSql);
      console.log(`Created database role ${targetUser}`);
    } else if (hasTargetPassword) {
      const alterRoleSql = format('ALTER ROLE %I WITH LOGIN PASSWORD %L', targetUser, targetPassword);
      await execute(client, alterRoleSql);
    }

    const dbExists = await execute(
      client,
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [targetDatabase]
    );

    if (dbExists.rowCount === 0) {
      const createDatabaseSql = format('CREATE DATABASE %I OWNER %I', targetDatabase, targetUser);
      await execute(client, createDatabaseSql);
      console.log(`Created database ${targetDatabase}`);
      createdDatabase = true;
    } else {
      const alterDatabaseSql = format('ALTER DATABASE %I OWNER TO %I', targetDatabase, targetUser);
      await execute(client, alterDatabaseSql);
    }

    const grantSql = format('GRANT ALL PRIVILEGES ON DATABASE %I TO %I', targetDatabase, targetUser);
    await execute(client, grantSql);

    let missingCoreTables = createdDatabase;

    if (!missingCoreTables) {
      missingCoreTables = await hasMissingCoreTables({
        host,
        port,
        user: rootUser,
        password: rootPassword,
        database: targetDatabase,
        ssl
      });
    }

    if (shouldApplySchema(createdDatabase, missingCoreTables)) {
      const schemaPath = resolveSchemaPath();

      try {
        const schemaSql = await readFile(schemaPath, 'utf8');

        if (schemaSql && schemaSql.trim().length > 0) {
          const schemaClient = new Client({
            host,
            port,
            user: rootUser,
            password: rootPassword,
            database: targetDatabase,
            ssl
          });

          try {
            await schemaClient.connect();
            await execute(schemaClient, schemaSql);
            console.log(`Applied schema from ${schemaPath}`);
          } finally {
            await schemaClient.end().catch(() => {});
          }
        } else {
          console.warn(`El archivo de esquema ${schemaPath} está vacío; no se aplicaron cambios.`);
        }
      } catch (schemaError) {
        console.error('No se pudo aplicar el esquema SQL durante el arranque automático', schemaError);
        throw schemaError;
      }
    }

    bootstrapped = true;
  } catch (error) {
    console.error('Failed to bootstrap database', error);
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}
