import { hexToBytes, roundMetric } from './helpers.js';

const parseJsonString = (input) => {
  try {
    return JSON.parse(input);
  } catch (err) {
    return null;
  }
};

const tryBase64 = (input) => {
  try {
    const buf = Buffer.from(input, 'base64');
    const text = buf.toString('utf8');
    return parseJsonString(text) || text;
  } catch (err) {
    return null;
  }
};

const decodeHexPayload = (hex) => {
  const bytes = hexToBytes(hex);
  return { rawBytes: Array.from(bytes) };
};

export const decodeMK2Payload = (payload) => {
  let content = payload;
  if (typeof payload === 'string') {
    content = parseJsonString(payload) ?? tryBase64(payload) ?? payload;
  }

  if (Array.isArray(content)) {
    return content;
  }

  if (typeof content === 'object' && content !== null) {
    return [content];
  }

  // fall back to treat as hex encoded sequence from external decoder
  return [decodeHexPayload(String(payload))];
};

export const normalizeMK2Records = (records) =>
  records
    .map((record) => {
      if (typeof record !== 'object' || record === null) {
        return null;
      }
      const gatewayMac = record.GatewayMAC || record.gatewayMac || record.gateway || null;
      const normalizedBattery = record.BattVoltage ?? record.BaTtVol ?? record.batteryVoltage ?? null;
      return {
        gatewayMac,
        bleMac: (record.BLEMAC || record.mac || record.bleMac || '').toUpperCase(),
        rssi: record.RSSI ?? record.rssi ?? null,
        advType: record.AdvType || record.advType || null,
        rawData: record.RawData || record.rawData || null,
        name: record.BLEName || record.name || null,
        batteryVoltage: normalizedBattery !== null ? roundMetric(Number(normalizedBattery)) : null,
        temperature: record.temperature ?? record.Temp ?? null,
        humidity: record.humidity ?? record.Humidity ?? null,
        timestamp: record.TimeStamp ? new Date(record.TimeStamp).toISOString() : null,
        metadata: record
      };
    })
    .filter(Boolean);

export const decodeAndNormalizeMK2 = (payload) => normalizeMK2Records(decodeMK2Payload(payload));

export default decodeAndNormalizeMK2;
