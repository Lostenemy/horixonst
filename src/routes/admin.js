import express from 'express';
import { body, param, validationResult } from 'express-validator';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query } from '../db/index.js';
import { getDeviceHistory } from '../services/deviceService.js';

const router = express.Router();

router.use(authenticate, requireRole('admin'));

router.post(
  '/gateways',
  body('mac').isString(),
  body('name').isString(),
  body('owner_id').isInt(),
  body('location_id').optional({ nullable: true }).isInt(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { mac, name, owner_id: ownerId, location_id: locationId } = req.body;
    try {
      const { rows } = await query(
        `INSERT INTO gateways (mac, name, owner_id, location_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [mac.toUpperCase(), name, ownerId, locationId || null]
      );
      return res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Gateway already exists' });
      }
      return res.status(500).json({ error: 'Failed to create gateway' });
    }
  }
);

router.get('/gateways', async (req, res) => {
  const { rows } = await query(
    `SELECT g.*, l.name AS location_name, u.username AS owner
     FROM gateways g
     JOIN users u ON u.id = g.owner_id
     LEFT JOIN locations l ON l.id = g.location_id
     ORDER BY g.created_at DESC`
  );
  res.json(rows);
});

router.post(
  '/devices',
  body('ble_mac').isString(),
  body('name').isString(),
  body('owner_id').isInt(),
  body('category_id').optional({ nullable: true }).isInt(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { ble_mac: bleMac, name, owner_id: ownerId, category_id: categoryId } = req.body;
    try {
      const { rows } = await query(
        `INSERT INTO devices (ble_mac, name, owner_id, category_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [bleMac.toUpperCase(), name, ownerId, categoryId || null]
      );
      return res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Device already exists' });
      }
      return res.status(500).json({ error: 'Failed to create device' });
    }
  }
);

router.get('/devices', async (req, res) => {
  const { rows } = await query(
    `SELECT d.*, u.username AS owner, c.name AS category_name
     FROM devices d
     JOIN users u ON u.id = d.owner_id
     LEFT JOIN device_categories c ON c.id = d.category_id
     ORDER BY d.created_at DESC`
  );
  res.json(rows);
});

router.get(
  '/devices/:id/history',
  param('id').isInt(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const deviceId = Number(req.params.id);
    const history = await getDeviceHistory(deviceId, req.user.id, req.user.role);
    res.json(history);
  }
);

router.get('/messages', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM mqtt_messages ORDER BY received_at DESC LIMIT 200'
  );
  res.json(rows);
});

export default router;
