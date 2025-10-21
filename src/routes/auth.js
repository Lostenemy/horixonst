import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import dotenv from 'dotenv';
import { query } from '../db/index.js';
import { authenticate, requireRole } from '../middleware/auth.js';

dotenv.config();

const router = express.Router();

const getSecret = () => process.env.JWT_SECRET || 'changeme';

router.post(
  '/login',
  body('username').isString(),
  body('password').isString(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    try {
      const { rows } = await query(
        `SELECT u.*, r.name AS role_name
         FROM users u
         JOIN user_roles r ON r.id = u.role_id
         WHERE u.username = $1`,
        [username]
      );

      const user = rows[0];
      if (!user) {
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }

      const token = jwt.sign({ sub: user.id, role: user.role_name }, getSecret(), { expiresIn: '12h' });
      return res.json({ token, user: { id: user.id, username: user.username, role: user.role_name } });
    } catch (err) {
      console.error('Error al iniciar sesión', err);
      return res.status(500).json({ error: 'Error interno al iniciar sesión' });
    }
  }
);

router.post(
  '/register',
  authenticate,
  requireRole('admin'),
  body('username').isString(),
  body('password').isLength({ min: 8 }),
  body('role').isIn(['admin', 'user']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { username, password, role } = req.body;
    const { rows: roleRows } = await query('SELECT id FROM user_roles WHERE name = $1', [role]);
    const roleRow = roleRows[0];
    if (!roleRow) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    try {
      const { rows } = await query(
        'INSERT INTO users (username, password_hash, role_id) VALUES ($1, $2, $3) RETURNING id, username',
        [username, passwordHash, roleRow.id]
      );
      return res.status(201).json({ user: rows[0] });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Username already exists' });
      }
      return res.status(500).json({ error: 'Failed to create user' });
    }
  }
);

export default router;
