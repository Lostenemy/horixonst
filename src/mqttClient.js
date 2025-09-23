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

export const createMqttClient = () => {
  const host = process.env.MQTT_HOST || 'www.agrosystem.es';
  const port = Number(process.env.MQTT_PORT || 1887);
  const clientId = buildClientId();

  const options = {
    clientId,
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASS,
    keepalive: Number(process.env.MQTT_KEEPALIVE || 60),
    reconnectPeriod: Number(process.env.MQTT_RECONNECT_PERIOD || 1000),
    protocolId: process.env.MQTT_PROTOCOL_ID || 'MQIsdp',
    protocolVersion: Number(process.env.MQTT_PROTOCOL_VERSION || 3),
    clean: process.env.MQTT_CLEAN !== 'false',
    connectTimeout: Number(process.env.MQTT_CONNECT_TIMEOUT || 10000),
    encoding: process.env.MQTT_ENCODING || 'utf8'
  };

  const brokerUrl = `mqtt://${host}:${port}`;
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
