import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { query } from '../db/index.js';

dotenv.config();

const getSecret = () => process.env.JWT_SECRET || 'changeme';

export const authenticate = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ error: 'Authorization header missing' });
  }

  const token = header.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Invalid authorization header' });
  }

  try {
    const payload = jwt.verify(token, getSecret());
    const { rows } = await query(
      `SELECT u.id, u.username, r.name AS role
       FROM users u
       JOIN user_roles r ON r.id = u.role_id
       WHERE u.id = $1`,
      [payload.sub]
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    req.user = user;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const requireRole = (role) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user.role !== role) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
};

export default authenticate;
