import express from 'express';
import { body, param, validationResult } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db/index.js';
import { getDeviceHistory, groupDevicesByLocation } from '../services/deviceService.js';

const router = express.Router();

router.use(authenticate);

const handleValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return true;
  }
  return false;
};

router.get('/me', (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
});

router.post(
  '/locations',
  body('name').isString(),
  body('description').optional({ nullable: true }).isString(),
  body('photo_url').optional({ nullable: true }).isString(),
  async (req, res) => {
    if (handleValidation(req, res)) return;
    const { name, description, photo_url: photoUrl } = req.body;
    const { rows } = await query(
      `INSERT INTO locations (name, description, photo_url, owner_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, description || null, photoUrl || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  }
);

router.get('/locations', async (req, res) => {
  const params = [req.user.id];
  let queryText = 'SELECT * FROM locations';
  if (req.user.role !== 'admin') {
    queryText += ' WHERE owner_id = $1';
  } else {
    params.pop();
  }
  const { rows } = await query(queryText, params.length ? params : []);
  res.json(rows);
});

router.get('/gateways', async (req, res) => {
  const params = [req.user.id];
  let queryText = `
    SELECT g.*, l.name AS location_name
    FROM gateways g
    LEFT JOIN locations l ON l.id = g.location_id
  `;
  if (req.user.role !== 'admin') {
    queryText += ' WHERE g.owner_id = $1';
  } else {
    params.pop();
  }
  queryText += ' ORDER BY g.created_at DESC';
  const { rows } = await query(queryText, params.length ? params : []);
  res.json(rows);
});

router.post(
  '/gateways/:id/assign-location',
  param('id').isInt(),
  body('location_id').isInt(),
  async (req, res) => {
    if (handleValidation(req, res)) return;
    const gatewayId = Number(req.params.id);
    const locationId = Number(req.body.location_id);
    const { rows } = await query('SELECT * FROM gateways WHERE id = $1', [gatewayId]);
    const gateway = rows[0];
    if (!gateway) {
      return res.status(404).json({ error: 'Gateway no encontrada' });
    }
    if (req.user.role !== 'admin' && gateway.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'No tienes permisos sobre esta gateway' });
    }
    await query('UPDATE gateways SET location_id = $1 WHERE id = $2', [locationId, gatewayId]);
    await query(
      `INSERT INTO gateway_locations (gateway_id, location_id)
       VALUES ($1, $2)
       ON CONFLICT (gateway_id, location_id) DO NOTHING`,
      [gatewayId, locationId]
    );
    res.json({ success: true });
  }
);

router.post(
  '/categories',
  body('name').isString(),
  body('description').optional({ nullable: true }).isString(),
  body('photo_url').optional({ nullable: true }).isString(),
  async (req, res) => {
    if (handleValidation(req, res)) return;
    const { name, description, photo_url: photoUrl } = req.body;
    const { rows } = await query(
      `INSERT INTO device_categories (name, description, photo_url, owner_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, description || null, photoUrl || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  }
);

router.get('/categories', async (req, res) => {
  const params = [req.user.id];
  let queryText = 'SELECT * FROM device_categories';
  if (req.user.role !== 'admin') {
    queryText += ' WHERE owner_id = $1';
  } else {
    params.pop();
  }
  const { rows } = await query(queryText, params.length ? params : []);
  res.json(rows);
});

router.post(
  '/devices/assign',
  body('ble_mac').isString(),
  body('name').optional({ nullable: true }).isString(),
  body('category_id').optional({ nullable: true }).isInt(),
  async (req, res) => {
    if (handleValidation(req, res)) return;
    const { ble_mac: bleMac, name, category_id: categoryId } = req.body;
    const existing = await query('SELECT * FROM devices WHERE ble_mac = $1', [bleMac.toUpperCase()]);
    let device;
    if (existing.rows[0]) {
      device = existing.rows[0];
      if (device.owner_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Device already assigned' });
      }
      await query('UPDATE devices SET name = COALESCE($1, name), category_id = COALESCE($2, category_id) WHERE id = $3', [
        name || null,
        categoryId || null,
        device.id
      ]);
    } else {
      const { rows } = await query(
        `INSERT INTO devices (ble_mac, name, owner_id, category_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [bleMac.toUpperCase(), name || bleMac.toUpperCase(), req.user.id, categoryId || null]
      );
      device = rows[0];
    }

    await query(
      `INSERT INTO device_assignments (user_id, device_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, device_id) DO NOTHING`,
      [req.user.id, device.id]
    );

    res.json(device);
  }
);

router.post(
  '/devices/:id/category',
  param('id').isInt(),
  body('category_id').isInt(),
  async (req, res) => {
    if (handleValidation(req, res)) return;
    const deviceId = Number(req.params.id);
    const categoryId = Number(req.body.category_id);
    const { rows } = await query('SELECT owner_id FROM devices WHERE id = $1', [deviceId]);
    const device = rows[0];
    if (!device) {
      return res.status(404).json({ error: 'Dispositivo no encontrado' });
    }
    if (req.user.role !== 'admin' && device.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'No tienes permisos sobre este dispositivo' });
    }
    await query('UPDATE devices SET category_id = $1 WHERE id = $2', [categoryId, deviceId]);
    res.json({ success: true });
  }
);

router.get('/devices', async (req, res) => {
  const params = [req.user.id];
  let queryText = `
    SELECT d.*, c.name AS category_name
    FROM devices d
    LEFT JOIN device_categories c ON c.id = d.category_id
  `;
  if (req.user.role !== 'admin') {
    queryText += ' WHERE d.owner_id = $1';
  } else {
    params.pop();
  }
  queryText += ' ORDER BY d.created_at DESC';
  const { rows } = await query(queryText, params.length ? params : []);
  res.json(rows);
});

router.get(
  '/devices/:id/history',
  param('id').isInt(),
  async (req, res) => {
    if (handleValidation(req, res)) return;
    const deviceId = Number(req.params.id);
    const history = await getDeviceHistory(deviceId, req.user.id, req.user.role);
    res.json(history);
  }
);

router.get('/devices-by-location', async (req, res) => {
  const data = await groupDevicesByLocation(req.user.id, req.user.role);
  res.json(data);
});

router.post(
  '/alarms',
  body('name').isString(),
  body('description').optional({ nullable: true }).isString(),
  body('threshold_seconds').isInt({ min: 30 }),
  body('device_ids').isArray({ min: 1 }),
  async (req, res) => {
    if (handleValidation(req, res)) return;
    const { name, description, threshold_seconds: thresholdSeconds, device_ids: deviceIds } = req.body;
    const { rows } = await query(
      `INSERT INTO alarms (name, description, threshold_seconds, owner_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, description || null, thresholdSeconds, req.user.id]
    );
    const alarm = rows[0];
    for (const deviceId of deviceIds) {
      await query(
        `INSERT INTO alarm_devices (alarm_id, device_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [alarm.id, deviceId]
      );
    }
    res.status(201).json(alarm);
  }
);

router.get('/alarms', async (req, res) => {
  const params = [req.user.id];
  let queryText = 'SELECT * FROM alarms';
  if (req.user.role !== 'admin') {
    queryText += ' WHERE owner_id = $1';
  } else {
    params.pop();
  }
  const { rows } = await query(queryText, params.length ? params : []);
  res.json(rows);
});

router.post(
  '/alarms/:id/resolve',
  param('id').isInt(),
  async (req, res) => {
    if (handleValidation(req, res)) return;
    const alarmId = Number(req.params.id);
    await query(
      `UPDATE alarm_events
       SET status = 'resolved', resolved_at = NOW(), resolver_id = $1
       WHERE alarm_id = $2 AND status = 'triggered'`,
      [req.user.id, alarmId]
    );
    res.json({ success: true });
  }
);


router.get('/user-groups', async (req, res) => {
  const params = [req.user.id];
  let queryText = 'SELECT * FROM user_groups';
  if (req.user.role !== 'admin') {
    queryText += ' WHERE owner_id = $1';
  } else {
    params.pop();
  }
  const { rows } = await query(queryText, params.length ? params : []);
  res.json(rows);
});

router.post(
  '/user-groups',
  body('name').isString(),
  async (req, res) => {
    if (handleValidation(req, res)) return;
    const { name } = req.body;
    const { rows } = await query(
      `INSERT INTO user_groups (name, owner_id)
       VALUES ($1, $2)
       RETURNING *`,
      [name, req.user.id]
    );
    res.status(201).json(rows[0]);
  }
);

router.post(
  '/user-groups/:id/members',
  param('id').isInt(),
  body('user_id').isInt(),
  body('can_manage_alarms').optional().isBoolean(),
  async (req, res) => {
    if (handleValidation(req, res)) return;
    const groupId = Number(req.params.id);
    const { user_id: userId, can_manage_alarms: canManageAlarms } = req.body;
    await query(
      `INSERT INTO user_group_members (group_id, user_id, can_manage_alarms)
       VALUES ($1, $2, $3)
       ON CONFLICT (group_id, user_id) DO UPDATE SET can_manage_alarms = EXCLUDED.can_manage_alarms`,
      [groupId, userId, Boolean(canManageAlarms)]
    );
    res.json({ success: true });
  }
);

router.get(
  '/alarm-events',
  async (req, res) => {
    let queryText = `
      SELECT ae.*, a.name AS alarm_name, d.name AS device_name
      FROM alarm_events ae
      JOIN alarms a ON a.id = ae.alarm_id
      JOIN devices d ON d.id = ae.device_id
    `;
    const params = [];
    if (req.user.role !== 'admin') {
      queryText += ' WHERE a.owner_id = $1';
      params.push(req.user.id);
    }
    queryText += ' ORDER BY ae.triggered_at DESC LIMIT 200';
    const { rows } = await query(queryText, params);
    res.json(rows);
  }
);

export default router;
