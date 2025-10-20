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

const shouldLogSql = (() => {
  const flag = process.env.DEBUG_BOOTSTRAP;

  if (flag === undefined) {
    return true;
  }

  const normalized = flag.trim().toLowerCase();
  return !['false', '0', 'no', 'off'].includes(normalized);
})();

const logSql = (sql, params) => {
  if (!shouldLogSql) {
    return;
  }

  const serializedParams = params ? JSON.stringify(params) : '[]';
  process.stdout.write(`[#bootstrap] SQL> ${sql}\n`);
  process.stdout.write(`[#bootstrap] params> ${serializedParams}\n`);
};

const execute = async (client, sql, params) => {
  logSql(sql, params);

  try {
    return await client.query(sql, params);
  } catch (error) {
    const payload = {
      sql,
      params,
      position: error?.position,
      code: error?.code
    };
    process.stderr.write(`[#bootstrap] Error al ejecutar SQL ${JSON.stringify(payload)}\n`);
    throw error;
  }
};

function splitSqlStatements(sql) {
  const stmts = [];
  let i = 0;
  let start = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null;

  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];

    if (!inSingle && !inDouble && !dollarTag && !inBlockComment && c === '-' && n === '-' && !inLineComment) {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (inLineComment && c === '\n') {
      inLineComment = false;
      i++;
      continue;
    }
    if (!inSingle && !inDouble && !dollarTag && !inLineComment && c === '/' && n === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (inBlockComment && c === '*' && n === '/') {
      inBlockComment = false;
      i += 2;
      continue;
    }
    if (inLineComment || inBlockComment) {
      i++;
      continue;
    }

    if (!dollarTag && !inDouble && c === '\'') {
      inSingle = !inSingle;
      i++;
      continue;
    }
    if (!dollarTag && !inSingle && c === '"') {
      inDouble = !inDouble;
      i++;
      continue;
    }

    if (!inSingle && !inDouble) {
      if (!dollarTag && c === '$') {
        const match = sql.slice(i).match(/^\$([A-Za-z0-9_]*)\$/);
        if (match) {
          dollarTag = match[1];
          i += match[0].length;
          continue;
        }
      } else if (dollarTag && c === '$') {
        const match = sql.slice(i).match(/^\$([A-Za-z0-9_]*)\$/);
        if (match && match[1] === dollarTag) {
          dollarTag = null;
          i += match[0].length;
          continue;
        }
      }
    }

    if (!inSingle && !inDouble && !dollarTag && c === ';') {
      const chunk = sql.slice(start, i).trim();
      if (chunk) {
        stmts.push(chunk);
      }
      start = i + 1;
    }

    i++;
  }

  const tail = sql.slice(start).trim();
  if (tail) {
    stmts.push(tail);
  }

  return stmts;
}

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
            const statements = splitSqlStatements(schemaSql);

            for (let idx = 0; idx < statements.length; idx += 1) {
              const statement = statements[idx];

              try {
                await execute(schemaClient, statement);
              } catch (error) {
                const info = {
                  code: error?.code,
                  position: error?.position
                };
                process.stderr.write(`[#bootstrap] Falló la sentencia #${idx + 1} ${JSON.stringify(info)}\n`);

                if (error?.position) {
                  const position = Number(error.position);
                  const preview = statement.slice(Math.max(0, position - 80), position + 80);
                  process.stderr.write(`[#bootstrap] preview cerca de la posición ${position}\n${preview}\n`);
                } else {
                  process.stderr.write(`[#bootstrap] sentencia completa que falló:\n${statement}\n`);
                }

                throw error;
              }
            }
            console.log(`Applied schema from ${schemaPath} en ${statements.length} sentencias`);
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
