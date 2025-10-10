import { hexToBytes, roundMetric } from './helpers.js';

const decodeEddystoneTLM = (bytes) => {
  for (let i = 0; i < bytes.length - 14; i += 1) {
    if (bytes[i] === 0xaa && bytes[i + 1] === 0xfe && bytes[i + 2] === 0x20) {
      const version = bytes[i + 3];
      const batt = (bytes[i + 4] << 8) | bytes[i + 5];
      const tempInt = (bytes[i + 6] << 24) >> 24; // sign extend
      const tempFrac = bytes[i + 7];
      const temperature = tempInt + tempFrac / 256;
      const advCount =
        (bytes[i + 8] << 24) |
        (bytes[i + 9] << 16) |
        (bytes[i + 10] << 8) |
        bytes[i + 11];
      const secCount =
        (bytes[i + 12] << 24) |
        (bytes[i + 13] << 16) |
        (bytes[i + 14] << 8) |
        bytes[i + 15];
      return {
        frame: 'eddystone-tlm',
        version,
        batteryVoltage: roundMetric(batt / 1000),
        temperature: roundMetric(temperature),
        advCount,
        secCount
      };
    }
  }
  return null;
};

export const decodeMK1Payload = (payload) => {
  let data;
  try {
    data = typeof payload === 'string' ? JSON.parse(payload) : payload;
  } catch (err) {
    console.error('Unable to parse MK1 payload', err);
    return [];
  }

  if (!Array.isArray(data)) {
    return [];
  }

  const gatewayInfo = data.find((entry) => entry.Format === 'Gateway');
  const gatewayMac = gatewayInfo?.GatewayMAC || gatewayInfo?.GatewayMac || gatewayInfo?.gatewayMac;

  return data
    .filter((entry) => entry.Format && entry.Format.toLowerCase().includes('raw'))
    .map((entry) => {
      const bytes = hexToBytes(entry.RawData);
      const tlm = decodeEddystoneTLM(bytes);
      const device = {
        gatewayMac,
        bleMac: (entry.BLEMAC || entry.BleMac || entry.bleMac || '').toUpperCase(),
        rssi: entry.RSSI ?? null,
        advType: entry.AdvType || null,
        rawData: entry.RawData || null,
        name: entry.BLEName || null,
        batteryVoltage: null,
        temperature: null,
        humidity: null,
        format: entry.Format,
        timestamp: entry.TimeStamp ? new Date(entry.TimeStamp).toISOString() : null,
        metadata: {
          ...entry
        }
      };

      if (tlm) {
        device.batteryVoltage = tlm.batteryVoltage;
        device.temperature = tlm.temperature;
        device.metadata.tlm = tlm;
      }

      if (entry.BattVoltage || entry.BaTtVol) {
        const rawBatt = entry.BattVoltage ?? entry.BaTtVol;
        device.batteryVoltage = roundMetric(Number(rawBatt));
      }

      return device;
    });
};

export default decodeMK1Payload;
