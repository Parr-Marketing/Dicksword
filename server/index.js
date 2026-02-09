const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { initDB, db } = require('./db');
const { authRouter, authenticateToken, getUserFromToken } = require('./auth');
const { setupSignaling } = require('./signaling');

const app = express();
const server = http.createServer(app);

// In production, allow same-origin only. In dev, allow Vite dev server.
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : false)
  : ['http://localhost:5173', 'http://localhost:3000'];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json());

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));
}

// Initialize database
initDB();

// Auth routes
app.use('/api/auth', authRouter);

// --- Server (guild) routes ---
app.get('/api/servers', authenticateToken, (req, res) => {
  const servers = db().prepare(`
    SELECT s.*, sm.role FROM servers s
    JOIN server_members sm ON sm.server_id = s.id
    WHERE sm.user_id = ?
    ORDER BY s.created_at
  `).all(req.user.id);
  res.json(servers);
});

app.post('/api/servers', authenticateToken, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Server name required' });

  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  const inviteCode = Math.random().toString(36).substring(2, 10);

  db().prepare('INSERT INTO servers (id, name, owner_id, invite_code) VALUES (?, ?, ?, ?)').run(id, name, req.user.id, inviteCode);
  db().prepare('INSERT INTO server_members (server_id, user_id, role) VALUES (?, ?, ?)').run(id, req.user.id, 'owner');

  // Create default channels
  const generalId = uuidv4();
  const voiceId = uuidv4();
  db().prepare('INSERT INTO channels (id, server_id, name, type) VALUES (?, ?, ?, ?)').run(generalId, id, 'general', 'text');
  db().prepare('INSERT INTO channels (id, server_id, name, type) VALUES (?, ?, ?, ?)').run(voiceId, id, 'Voice Chat', 'voice');

  const server = db().prepare('SELECT * FROM servers WHERE id = ?').get(id);
  res.json(server);
});

app.post('/api/servers/join', authenticateToken, (req, res) => {
  const { inviteCode } = req.body;
  const server = db().prepare('SELECT * FROM servers WHERE invite_code = ?').get(inviteCode);
  if (!server) return res.status(404).json({ error: 'Invalid invite code' });

  const existing = db().prepare('SELECT * FROM server_members WHERE server_id = ? AND user_id = ?').get(server.id, req.user.id);
  if (existing) return res.json(server);

  db().prepare('INSERT INTO server_members (server_id, user_id, role) VALUES (?, ?, ?)').run(server.id, req.user.id, 'member');
  res.json(server);
});

// --- Channel routes ---
app.get('/api/servers/:serverId/channels', authenticateToken, (req, res) => {
  const channels = db().prepare('SELECT * FROM channels WHERE server_id = ? ORDER BY type, created_at').all(req.params.serverId);
  res.json(channels);
});

app.post('/api/servers/:serverId/channels', authenticateToken, (req, res) => {
  const { name, type } = req.body;
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  db().prepare('INSERT INTO channels (id, server_id, name, type) VALUES (?, ?, ?, ?)').run(id, req.params.serverId, name, type || 'text');
  const channel = db().prepare('SELECT * FROM channels WHERE id = ?').get(id);
  res.json(channel);
});

// --- Message routes ---
app.get('/api/channels/:channelId/messages', authenticateToken, (req, res) => {
  const messages = db().prepare(`
    SELECT m.*, u.username, u.avatar_color FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.channel_id = ?
    ORDER BY m.created_at DESC LIMIT 50
  `).all(req.params.channelId);
  res.json(messages.reverse());
});

// --- Members route ---
app.get('/api/servers/:serverId/members', authenticateToken, (req, res) => {
  const members = db().prepare(`
    SELECT u.id, u.username, u.avatar_color, sm.role FROM users u
    JOIN server_members sm ON sm.user_id = u.id
    WHERE sm.server_id = ?
  `).all(req.params.serverId);
  res.json(members);
});

// --- Profile route ---
app.put('/api/profile', authenticateToken, (req, res) => {
  const { username, avatar_color } = req.body;
  if (username) {
    db().prepare('UPDATE users SET username = ? WHERE id = ?').run(username, req.user.id);
  }
  if (avatar_color) {
    db().prepare('UPDATE users SET avatar_color = ? WHERE id = ?').run(avatar_color, req.user.id);
  }
  const user = db().prepare('SELECT id, username, email, avatar_color FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// Socket.IO authentication and real-time
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const user = getUserFromToken(token);
  if (!user) return next(new Error('Authentication error'));
  socket.user = user;
  next();
});

// Track who's in voice channels
const voiceState = new Map(); // channelId -> Set of { socketId, userId, username }

io.on('connection', (socket) => {
  console.log(`${socket.user.username} connected`);

  // Join a server room
  socket.on('join-server', (serverId) => {
    socket.join(`server:${serverId}`);
  });

  // Join a text channel
  socket.on('join-channel', (channelId) => {
    socket.join(`channel:${channelId}`);
  });

  socket.on('leave-channel', (channelId) => {
    socket.leave(`channel:${channelId}`);
  });

  // Send a message
  socket.on('send-message', ({ channelId, content }) => {
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    db().prepare('INSERT INTO messages (id, channel_id, user_id, content) VALUES (?, ?, ?, ?)').run(id, channelId, socket.user.id, content);
    const message = db().prepare(`
      SELECT m.*, u.username, u.avatar_color FROM messages m
      JOIN users u ON u.id = m.user_id WHERE m.id = ?
    `).get(id);
    io.to(`channel:${channelId}`).emit('new-message', message);
  });

  // Voice channel signaling
  setupSignaling(io, socket, voiceState);

  socket.on('disconnect', () => {
    console.log(`${socket.user.username} disconnected`);
    // Remove from all voice channels
    for (const [channelId, users] of voiceState.entries()) {
      const user = [...users].find(u => u.socketId === socket.id);
      if (user) {
        users.delete(user);
        if (users.size === 0) voiceState.delete(channelId);
        io.to(`voice:${channelId}`).emit('voice-user-left', {
          userId: socket.user.id,
          username: socket.user.username,
          users: [...(voiceState.get(channelId) || [])]
        });
      }
    }
  });
});

// Catch-all for SPA in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Dicksword server running on port ${PORT}`);
});
