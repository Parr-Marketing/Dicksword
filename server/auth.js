const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { db } = require('./db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dicksword-secret-change-me-in-production';

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = db().prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (existing) {
      return res.status(400).json({ error: 'Username or email already taken' });
    }

    const id = uuidv4();
    const password_hash = await bcrypt.hash(password, 10);
    const colors = ['#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245', '#F47B67', '#E67E22', '#1ABC9C'];
    const avatar_color = colors[Math.floor(Math.random() * colors.length)];

    db().prepare('INSERT INTO users (id, username, email, password_hash, avatar_color) VALUES (?, ?, ?, ?, ?)')
      .run(id, username, email, password_hash, avatar_color);

    const token = jwt.sign({ id, username, email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id, username, email, avatar_color } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db().prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, avatar_color: user.avatar_color }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get current user
router.get('/me', authenticateToken, (req, res) => {
  const user = db().prepare('SELECT id, username, email, avatar_color FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function getUserFromToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = { authRouter: router, authenticateToken, getUserFromToken };
