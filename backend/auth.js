const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool, createUser, ROLES } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET missing from environment — populate backend/.env');
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;

function sign(user) {
  return jwt.sign(
    { uid: user.id, username: user.username, role: user.role || 'Visitor' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
}

function verify(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

function clientIp(req) {
  const xf = req.headers?.['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

async function recordFailedLogin({ username, userId, ip, reason }) {
  try {
    await getPool().query(
      'INSERT INTO failed_logins (username, user_id, ip, reason) VALUES (?, ?, ?, ?)',
      [username || null, userId || null, ip || null, reason || null],
    );
  } catch (err) {
    // Audit failures should never break login — just log.
    console.warn('[auth] failed_logins insert failed:', err.message);
  }
}

async function login(req, res) {
  const { username, password } = req.body || {};
  const ip = clientIp(req);
  if (!username || !password) {
    await recordFailedLogin({ username, ip, reason: 'missing_fields' });
    return res.status(400).json({ error: 'username and password required' });
  }
  const [rows] = await getPool().query(
    'SELECT id, username, password_hash, role FROM users WHERE username = ? LIMIT 1',
    [username],
  );
  const user = rows[0];
  if (!user) {
    await recordFailedLogin({ username, ip, reason: 'unknown_user' });
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    await recordFailedLogin({ username, userId: user.id, ip, reason: 'bad_password' });
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const token = sign(user);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
}

async function signup(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'username must be 3-32 chars: letters, digits, _ or -' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  }

  const [exists] = await getPool().query('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
  if (exists.length) return res.status(409).json({ error: 'username already taken' });

  try {
    // Bootstrap: if there are no users yet, the very first signup becomes Admin
    // so the freshly-installed dashboard always has someone who can manage roles.
    // Every subsequent self-signup is a Visitor; an Admin promotes from there.
    const [allUsers] = await getPool().query('SELECT id FROM users LIMIT 1');
    const role = allUsers.length === 0 ? 'Admin' : 'Visitor';
    const user = await createUser(username, password, role);
    const token = sign(user);
    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function httpAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  const tok = (m && m[1]) || req.query?.token;
  const payload = tok && verify(tok);
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  req.user = payload;
  next();
}

function socketAuth(socket, next) {
  const token = socket.handshake?.auth?.token;
  const payload = token && verify(token);
  if (!payload) return next(new Error('unauthorized'));
  socket.user = payload;
  next();
}

// Re-checks the user's CURRENT role in the DB so demotions take effect
// immediately, not on the next token refresh. Caches the role onto req.user
// so downstream handlers can read it without another query.
function requireRole(...allowed) {
  const set = new Set(allowed);
  return async function roleGate(req, res, next) {
    try {
      const [rows] = await getPool().query(
        'SELECT role FROM users WHERE id = ? LIMIT 1',
        [req.user.uid],
      );
      const role = rows[0]?.role;
      if (!role) return res.status(401).json({ error: 'unknown user' });
      req.user.role = role;
      if (!set.has(role)) {
        return res.status(403).json({ error: 'forbidden', requiredRoles: [...set], yourRole: role });
      }
      next();
    } catch (err) {
      console.error('[auth] requireRole failed:', err);
      res.status(500).json({ error: 'role check failed' });
    }
  };
}

// Sugar for Admin + Moderator (mutation routes).
function requireWrite(req, res, next) {
  return requireRole('Admin', 'Moderator')(req, res, next);
}

// Sugar for Admin only (user-management routes).
function requireAdmin(req, res, next) {
  return requireRole('Admin')(req, res, next);
}

module.exports = {
  login,
  signup,
  httpAuth,
  socketAuth,
  requireRole,
  requireWrite,
  requireAdmin,
  ROLES,
};
