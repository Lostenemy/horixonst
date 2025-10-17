import mqtt from 'mqtt';
import dotenv from 'dotenv';
import decodeMK1Payload from './decoders/mk1Decoder.js';
import decodeAndNormalizeMK2 from './decoders/mk2Decoder.js';
import decodeMK3Payload from './decoders/mk3Decoder.js';
import { processDeviceRecord, recordMqttMessage } from './services/deviceService.js';

dotenv.config();

const topics = {
  mk1: 'devices/MK1',
  mk2: 'devices/MK2',
  mk3: 'devices/MK3'
};

const buildClientId = () => {
  const prefix = process.env.MQTT_CLIENT_PREFIX || 'acces_control_server_';
  const random = Math.floor(Math.random() * 1_000_000);
  return `${prefix}${random}`;
};

const decodeByTopic = (topic, payload) => {
  switch (topic) {
    case topics.mk1:
      return decodeMK1Payload(payload);
    case topics.mk2:
      return decodeAndNormalizeMK2(payload);
    case topics.mk3:
      return decodeMK3Payload(payload);
    default:
      return [];
  }
};

const stringPayload = (payload) => {
  if (Buffer.isBuffer(payload)) {
    return payload.toString('utf8');
  }
  if (typeof payload === 'string') {
    return payload;
  }
  return JSON.stringify(payload);
};

const resolveString = (value) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const DEFAULT_MQTT_USERNAME = 'mqtt';
const DEFAULT_MQTT_PASSWORD = '20025@BLELoRa';
const DEFAULT_MQTT_HOST = 'mqtt';
const DEFAULT_MQTT_PORT = 1883;

const sanitizeUrl = (urlInstance) => {
  if (urlInstance.pathname === '/' && !urlInstance.search && !urlInstance.hash) {
    urlInstance.pathname = '';
  }
  return urlInstance.toString();
};

const buildBrokerUrl = (port) => {
  const configuredUrl = resolveString(process.env.MQTT_URL);
  const rawHost = resolveString(process.env.MQTT_HOST) || DEFAULT_MQTT_HOST;
  const scheme = 'mqtt';

  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      if (Number.isFinite(port) && port > 0) {
        parsed.port = String(port);
      } else if (!parsed.port) {
        parsed.port = String(DEFAULT_MQTT_PORT);
      }
      return sanitizeUrl(parsed);
    } catch (err) {
      console.warn('MQTT_URL inválida, se intentará usar MQTT_HOST en su lugar', err);
    }
  }

  try {
    const prefix = rawHost.includes('://') ? '' : `${scheme}://`;
    const parsed = new URL(`${prefix}${rawHost}`);
    if (Number.isFinite(port) && port > 0) {
      parsed.port = String(port);
    } else if (!parsed.port) {
      parsed.port = String(DEFAULT_MQTT_PORT);
    }
    if (!parsed.protocol) {
      parsed.protocol = `${scheme}:`;
    }
    return sanitizeUrl(parsed);
  } catch (err) {
    const sanitizedHost = rawHost.replace(/\/$/, '');
    const finalPort = Number.isFinite(port) && port > 0 ? port : DEFAULT_MQTT_PORT;
    return `${scheme}://${sanitizedHost}:${finalPort}`;
  }
};

export const createMqttClient = () => {
  const configuredPort = Number(process.env.MQTT_PORT);
  const port = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : DEFAULT_MQTT_PORT;
  const clientId = buildClientId();
  const usernameEnvDefined = Object.prototype.hasOwnProperty.call(process.env, 'MQTT_USER');
  const passwordEnvDefined = Object.prototype.hasOwnProperty.call(process.env, 'MQTT_PASS');
  const envUsername = resolveString(process.env.MQTT_USER);
  const envPassword = resolveString(process.env.MQTT_PASS);

  const rawProtocolVersion = Number(process.env.MQTT_PROTOCOL_VERSION || 4);
  const protocolVersion = Number.isFinite(rawProtocolVersion) && rawProtocolVersion > 0 ? rawProtocolVersion : 4;
  const configuredProtocolId = process.env.MQTT_PROTOCOL_ID;
  const protocolId = configuredProtocolId && configuredProtocolId.trim().length
    ? configuredProtocolId.trim()
    : protocolVersion === 3
      ? 'MQIsdp'
      : 'MQTT';

  const options = {
    clientId,
    username: usernameEnvDefined ? envUsername : DEFAULT_MQTT_USERNAME,
    password: passwordEnvDefined ? envPassword : DEFAULT_MQTT_PASSWORD,
    keepalive: Number(process.env.MQTT_KEEPALIVE || 60),
    reconnectPeriod: Number(process.env.MQTT_RECONNECT_PERIOD || 1000),
    protocolId,
    protocolVersion,
    clean: process.env.MQTT_CLEAN !== 'false',
    connectTimeout: Number(process.env.MQTT_CONNECT_TIMEOUT || 10000),
    encoding: process.env.MQTT_ENCODING || 'utf8'
  };

  if (!options.username) {
    delete options.username;
    delete options.password;
  } else if (!options.password) {
    delete options.password;
  }

  const brokerUrl = buildBrokerUrl(port);
  const client = mqtt.connect(brokerUrl, options);

  client.on('connect', () => {
    console.log('Connected to MQTT broker', brokerUrl);
    Object.values(topics).forEach((topic) => client.subscribe(topic, (err) => {
      if (err) {
        console.error('Failed to subscribe to topic', topic, err);
      } else {
        console.log('Subscribed to topic', topic);
      }
    }));
  });

  client.on('reconnect', () => {
    console.log('Reconnecting to MQTT broker...');
  });

  client.on('error', (err) => {
    console.error('MQTT error', err);
  });

  client.on('message', async (topic, payloadBuffer) => {
    const payload = stringPayload(payloadBuffer);
    try {
      await recordMqttMessage(topic, payload);
    } catch (err) {
      console.error('Failed to persist raw MQTT message', err);
    }

    const records = decodeByTopic(topic, payload);
    for (const record of records) {
      const outcome = await processDeviceRecord(record, topic);
      if (outcome.status === 'error') {
        console.error('Failed to process device record', outcome.error, record);
      }
    }
  });

  return client;
};

export default createMqttClient;
