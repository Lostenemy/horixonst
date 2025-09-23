import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
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

const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

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
