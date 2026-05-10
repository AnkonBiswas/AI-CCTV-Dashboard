const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool, createUser } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET missing from environment — populate backend/.env');
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;

function sign(user) {
  return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verify(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

async function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  const [rows] = await getPool().query('SELECT id, username, password_hash FROM users WHERE username = ? LIMIT 1', [username]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'invalid credentials' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });

  const token = sign(user);
  res.json({ token, user: { id: user.id, username: user.username } });
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
    const user = await createUser(username, password);
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

module.exports = { login, signup, httpAuth, socketAuth };
