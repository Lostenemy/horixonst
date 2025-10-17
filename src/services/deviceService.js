import format from 'pg-format';
import { query, getClient } from '../db/index.js';

const DEDUP_WINDOW_MS = 5000;
const NO_ACTION_THRESHOLD_MS = 30 * 1000;
const UPDATE_THRESHOLD_MS = 5 * 60 * 1000;

export const recordMqttMessage = async (topic, payload) => {
  let body = payload;
  if (typeof payload === 'string') {
    try {
      body = JSON.parse(payload);
    } catch (err) {
      body = { raw: payload };
    }
  }
  await query('INSERT INTO mqtt_messages (topic, payload) VALUES ($1, $2)', [topic, body]);
};

const getGateway = async (mac) => {
  if (!mac) return null;
  const { rows } = await query(
    'SELECT g.*, COALESCE(g.location_id, gl.location_id) AS effective_location_id FROM gateways g LEFT JOIN gateway_locations gl ON gl.gateway_id = g.id WHERE g.mac = $1 AND g.is_active = TRUE LIMIT 1',
    [mac.toUpperCase()]
  );
  return rows[0] || null;
};

const getDevice = async (bleMac) => {
  if (!bleMac) return null;
  const { rows } = await query('SELECT * FROM devices WHERE ble_mac = $1', [bleMac.toUpperCase()]);
  return rows[0] || null;
};

const getSnapshot = async (deviceId, locationId) => {
  const { rows } = await query(
    'SELECT * FROM device_state_snapshots WHERE device_id = $1 AND ((location_id IS NULL AND $2 IS NULL) OR location_id = $2) LIMIT 1',
    [deviceId, locationId]
  );
  return rows[0] || null;
};

const updateSnapshot = async (client, snapshotId, data) => {
  const columns = Object.keys(data);
  const values = Object.values(data);

  const assignments = columns.map((column, index) => `${format('%I', column)} = $${index + 1}`);
  const setClause = assignments.length ? `${assignments.join(', ')}, updated_at = NOW()` : 'updated_at = NOW()';

  values.push(snapshotId);

  await client.query(
    `UPDATE device_state_snapshots SET ${setClause} WHERE id = $${assignments.length + 1}`,
    values
  );
};

const insertSnapshot = async (client, data) => {
  const columns = Object.keys(data);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const values = Object.values(data);

  const columnList = columns.map((column) => format('%I', column)).join(', ');

  const { rows } = await client.query(
    `INSERT INTO device_state_snapshots (${columnList}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    values
  );
  return rows[0];
};

const normalizeBatteryVoltage = (value) => {
  if (value === undefined || value === null) return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  return Math.round(num * 1000) / 1000;
};

const shouldSkipBecauseRecentSameLocation = async (deviceId, locationId, now) => {
  if (!locationId) return false;
  const { rows } = await query(
    `SELECT seen_at FROM device_readings
     WHERE device_id = $1 AND location_id = $2
     ORDER BY seen_at DESC
     LIMIT 1`,
    [deviceId, locationId]
  );
  if (!rows[0]) {
    return false;
  }
  const seenAt = new Date(rows[0].seen_at);
  return now.getTime() - seenAt.getTime() < DEDUP_WINDOW_MS;
};

const updateReading = async (client, readingId, data) => {
  const columns = Object.keys(data);
  const values = Object.values(data);

  const assignments = columns.map((column, index) => `${format('%I', column)} = $${index + 1}`);
  const setClause = assignments.length ? `${assignments.join(', ')}, updated_at = NOW()` : 'updated_at = NOW()';

  values.push(readingId);

  await client.query(
    `UPDATE device_readings SET ${setClause} WHERE id = $${assignments.length + 1}`,
    values
  );
};

const insertReading = async (client, data) => {
  const columns = Object.keys(data);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const values = Object.values(data);
  const columnList = columns.map((column) => format('%I', column)).join(', ');

  const { rows } = await client.query(
    `INSERT INTO device_readings (${columnList}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    values
  );
  return rows[0];
};

export const processDeviceRecord = async (record, topic) => {
  const now = new Date();
  const gateway = await getGateway(record.gatewayMac);
  if (!gateway) {
    return { status: 'ignored', reason: 'gateway_not_registered' };
  }

  const device = await getDevice(record.bleMac);
  if (!device) {
    return { status: 'ignored', reason: 'device_not_registered' };
  }

  const locationId = gateway.effective_location_id || null;

  if (await shouldSkipBecauseRecentSameLocation(device.id, locationId, now)) {
    return { status: 'ignored', reason: 'duplicate_same_location_window' };
  }

  const snapshot = await getSnapshot(device.id, locationId);
  const lastSeen = snapshot ? new Date(snapshot.last_seen) : null;
  const diff = lastSeen ? now.getTime() - lastSeen.getTime() : null;
  const client = await getClient();

  try {
    await client.query('BEGIN');

    const readingData = {
      device_id: device.id,
      gateway_id: gateway.id,
      location_id: locationId,
      rssi: record.rssi,
      adv_type: record.advType,
      raw_data: record.rawData,
      battery_voltage: normalizeBatteryVoltage(record.batteryVoltage ?? record.metadata?.BattVoltage ?? record.metadata?.BaTtVol),
      temperature: record.temperature ?? record.metadata?.temperature ?? null,
      humidity: record.humidity ?? record.metadata?.humidity ?? null,
      status: record.status || null,
      seen_at: now.toISOString()
    };

    if (snapshot && diff !== null) {
      if (diff < NO_ACTION_THRESHOLD_MS) {
        await updateSnapshot(client, snapshot.id, {
          last_seen: now.toISOString(),
          gateway_id: gateway.id,
          status: readingData.status,
          battery_voltage: readingData.battery_voltage,
          temperature: readingData.temperature,
          humidity: readingData.humidity
        });
        await client.query('COMMIT');
        return { status: 'skipped', reason: 'recently_seen' };
      }

      const { rows } = await client.query(
        `SELECT * FROM device_readings
         WHERE device_id = $1 AND ((location_id IS NULL AND $2 IS NULL) OR location_id = $2)
         ORDER BY seen_at DESC
         LIMIT 1`,
        [device.id, locationId]
      );
      const lastReading = rows[0] || null;

      if (diff <= UPDATE_THRESHOLD_MS && lastReading) {
        await updateReading(client, lastReading.id, readingData);
        await updateSnapshot(client, snapshot.id, {
          last_seen: now.toISOString(),
          gateway_id: gateway.id,
          status: readingData.status,
          battery_voltage: readingData.battery_voltage,
          temperature: readingData.temperature,
          humidity: readingData.humidity
        });
        await client.query('COMMIT');
        return { status: 'updated', readingId: lastReading.id };
      }
    }

    const reading = await insertReading(client, readingData);
    if (snapshot) {
      await updateSnapshot(client, snapshot.id, {
        last_seen: now.toISOString(),
        gateway_id: gateway.id,
        status: readingData.status,
        battery_voltage: readingData.battery_voltage,
        temperature: readingData.temperature,
        humidity: readingData.humidity
      });
    } else {
      await insertSnapshot(client, {
        device_id: device.id,
        location_id: locationId,
        gateway_id: gateway.id,
        last_seen: now.toISOString(),
        status: readingData.status,
        battery_voltage: readingData.battery_voltage,
        temperature: readingData.temperature,
        humidity: readingData.humidity
      });
    }

    await client.query('COMMIT');
    return { status: 'inserted', readingId: reading.id };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error processing device record', err);
    return { status: 'error', error: err.message };
  } finally {
    client.release();
  }
};

export const groupDevicesByLocation = async (userId, role) => {
  const params = [];
  let queryText = `
    SELECT l.id AS location_id,
           l.name AS location_name,
           l.photo_url AS location_photo,
           json_agg(json_build_object(
             'id', d.id,
             'name', d.name,
             'ble_mac', d.ble_mac,
             'last_seen', s.last_seen,
             'battery_voltage', s.battery_voltage,
             'temperature', s.temperature,
             'humidity', s.humidity,
             'status', s.status
           ) ORDER BY s.last_seen DESC) AS devices
    FROM device_state_snapshots s
    JOIN devices d ON d.id = s.device_id
    LEFT JOIN locations l ON l.id = s.location_id
  `;

  if (role !== 'admin') {
    params.push(userId);
    queryText += ' WHERE d.owner_id = $1';
  }

  queryText += `
    GROUP BY l.id, l.name, l.photo_url
    ORDER BY l.name NULLS LAST`;

  const { rows } = await query(queryText, params);
  return rows;
};

export const getDeviceHistory = async (deviceId, userId, role) => {
  const params = [deviceId];
  let queryText = `
    SELECT r.*, g.name AS gateway_name, l.name AS location_name
    FROM device_readings r
    LEFT JOIN gateways g ON g.id = r.gateway_id
    LEFT JOIN locations l ON l.id = r.location_id
    WHERE r.device_id = $1
  `;

  if (role !== 'admin') {
    params.push(userId);
    queryText += ' AND r.device_id IN (SELECT id FROM devices WHERE owner_id = $2)';
  }

  queryText += ' ORDER BY r.seen_at DESC LIMIT 500';

  const { rows } = await query(queryText, params);
  return rows;
};

export const evaluateAlarms = async () => {
  const selectAlarmsSql = `SELECT a.*, ad.device_id
     FROM alarms a
     JOIN alarm_devices ad ON ad.alarm_id = a.id
     WHERE a.is_active = TRUE`;
  console.debug('[evaluateAlarms] SQL>', selectAlarmsSql);
  const { rows: alarms } = await query(selectAlarmsSql);

  const now = new Date();

  for (const alarm of alarms) {
    const selectSnapshotSql =
      'SELECT * FROM device_state_snapshots WHERE device_id = $1 ORDER BY last_seen DESC LIMIT 1';
    console.debug('[evaluateAlarms] SQL>', selectSnapshotSql, [alarm.device_id]);
    const { rows: snapshots } = await query(selectSnapshotSql, [alarm.device_id]);

    const lastSeen = snapshots[0]?.last_seen ? new Date(snapshots[0].last_seen) : null;

    if (!lastSeen) {
      continue;
    }

    const diffSeconds = (now.getTime() - lastSeen.getTime()) / 1000;
    if (diffSeconds > alarm.threshold_seconds) {
      const insertEventSql = `INSERT INTO alarm_events (alarm_id, device_id, status)
         VALUES ($1, $2, 'triggered')
         ON CONFLICT DO NOTHING`;
      console.debug('[evaluateAlarms] SQL>', insertEventSql, [alarm.id, alarm.device_id]);
      await query(insertEventSql, [alarm.id, alarm.device_id]);
    }
  }
};
