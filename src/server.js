import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';
import https from 'https';
import routes from './routes/index.js';
import createMqttClient from './mqttClient.js';
import { evaluateAlarms } from './services/deviceService.js';

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', routes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const port = Number(process.env.PORT || 8080);
const useHttps = String(process.env.HTTPS_ENABLED || '').toLowerCase() === 'true';

let server;

if (useHttps) {
  const keyPath = process.env.HTTPS_KEY_PATH;
  const certPath = process.env.HTTPS_CERT_PATH;

  if (!keyPath || !certPath) {
    console.warn('HTTPS_ENABLED está activo, pero faltan HTTPS_KEY_PATH o HTTPS_CERT_PATH. Iniciando en HTTP.');
  } else {
    try {
      const credentials = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      };
      server = https.createServer(credentials, app).listen(port, () => {
        console.log(`HTTPS server running on port ${port}`);
      });
    } catch (err) {
      console.error('No se pudo iniciar el servidor HTTPS con los certificados proporcionados:', err);
      process.exit(1);
    }
  }
}

if (!server) {
  server = http.createServer(app).listen(port, () => {
    console.log(`HTTP server running on port ${port}`);
  });
}

const mqttClient = createMqttClient();

setInterval(() => {
  evaluateAlarms().catch((err) => console.error('Failed to evaluate alarms', err));
}, 60 * 1000);

process.on('SIGINT', () => {
  console.log('Shutting down...');
  mqttClient.end();
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  mqttClient.end();
  server.close(() => process.exit(0));
});
