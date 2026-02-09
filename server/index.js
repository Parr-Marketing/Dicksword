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

// Health check (for Railway)
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

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

// --- Friend routes ---
app.get('/api/friends', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const friends = db().prepare(`
    SELECT u.id, u.username, u.avatar_color, f.status, f.sender_id, f.receiver_id, f.id as friendship_id
    FROM friendships f
    JOIN users u ON (u.id = CASE WHEN f.sender_id = ? THEN f.receiver_id ELSE f.sender_id END)
    WHERE (f.sender_id = ? OR f.receiver_id = ?) AND f.status = 'accepted'
  `).all(userId, userId, userId);
  res.json(friends);
});

app.get('/api/friends/pending', authenticateToken, (req, res) => {
  const userId = req.user.id;
  // Incoming requests
  const incoming = db().prepare(`
    SELECT u.id, u.username, u.avatar_color, f.id as friendship_id, 'incoming' as direction
    FROM friendships f JOIN users u ON u.id = f.sender_id
    WHERE f.receiver_id = ? AND f.status = 'pending'
  `).all(userId);
  // Outgoing requests
  const outgoing = db().prepare(`
    SELECT u.id, u.username, u.avatar_color, f.id as friendship_id, 'outgoing' as direction
    FROM friendships f JOIN users u ON u.id = f.receiver_id
    WHERE f.sender_id = ? AND f.status = 'pending'
  `).all(userId);
  res.json([...incoming, ...outgoing]);
});

app.post('/api/friends/request', authenticateToken, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  const target = db().prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: "Can't add yourself" });

  // Check existing friendship
  const existing = db().prepare(`
    SELECT * FROM friendships
    WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
  `).get(req.user.id, target.id, target.id, req.user.id);
  if (existing) {
    if (existing.status === 'accepted') return res.status(400).json({ error: 'Already friends' });
    return res.status(400).json({ error: 'Request already pending' });
  }

  const { v4: uuidv4 } = require('uuid');
  db().prepare('INSERT INTO friendships (id, sender_id, receiver_id, status) VALUES (?, ?, ?, ?)')
    .run(uuidv4(), req.user.id, target.id, 'pending');

  // Notify the target user via socket if online
  const targetSocket = onlineUsers.get(target.id);
  if (targetSocket) {
    io.to(targetSocket).emit('friend-request-received', { from: req.user.id, username: req.user.username });
  }

  res.json({ success: true });
});

app.post('/api/friends/accept', authenticateToken, (req, res) => {
  const { friendshipId } = req.body;
  const f = db().prepare('SELECT * FROM friendships WHERE id = ? AND receiver_id = ? AND status = ?').get(friendshipId, req.user.id, 'pending');
  if (!f) return res.status(404).json({ error: 'Request not found' });
  db().prepare('UPDATE friendships SET status = ? WHERE id = ?').run('accepted', friendshipId);

  // Notify sender
  const senderSocket = onlineUsers.get(f.sender_id);
  if (senderSocket) {
    io.to(senderSocket).emit('friend-request-accepted', { by: req.user.id, username: req.user.username });
  }

  res.json({ success: true });
});

app.post('/api/friends/reject', authenticateToken, (req, res) => {
  const { friendshipId } = req.body;
  db().prepare('DELETE FROM friendships WHERE id = ? AND (receiver_id = ? OR sender_id = ?)').run(friendshipId, req.user.id, req.user.id);
  res.json({ success: true });
});

app.delete('/api/friends/:friendshipId', authenticateToken, (req, res) => {
  db().prepare('DELETE FROM friendships WHERE id = ? AND (sender_id = ? OR receiver_id = ?)').run(req.params.friendshipId, req.user.id, req.user.id);
  res.json({ success: true });
});

// --- Recently Seen route ---
app.get('/api/recently-seen', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const seen = recentlySeen.get(userId);
  if (!seen) return res.json([]);

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  // Get existing friend/pending IDs to exclude
  const excludeIds = new Set(
    db().prepare(`
      SELECT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as fid
      FROM friendships WHERE (sender_id = ? OR receiver_id = ?)
    `).all(userId, userId, userId).map(f => f.fid)
  );

  const results = [];
  for (const [seenId, data] of seen) {
    if (data.lastSeen > oneDayAgo && !excludeIds.has(seenId)) {
      results.push(data);
    }
  }
  results.sort((a, b) => b.lastSeen - a.lastSeen);
  res.json(results);
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
// Track online users: userId -> socketId
const onlineUsers = new Map();
// Track recently seen users in voice: userId -> Map<seenUserId, { userId, username, avatar_color, lastSeen }>
const recentlySeen = new Map();

function updateRecentlySeen(userId, seenUserId, seenUsername) {
  if (userId === seenUserId) return;
  if (!recentlySeen.has(userId)) recentlySeen.set(userId, new Map());
  const seenUser = db().prepare('SELECT avatar_color FROM users WHERE id = ?').get(seenUserId);
  recentlySeen.get(userId).set(seenUserId, {
    userId: seenUserId,
    username: seenUsername,
    avatar_color: seenUser?.avatar_color || '#5865F2',
    lastSeen: Date.now()
  });
}

io.on('connection', (socket) => {
  console.log(`${socket.user.username} connected`);

  // Track online status
  onlineUsers.set(socket.user.id, socket.id);
  // Broadcast online status to friends
  broadcastOnlineStatus(socket.user.id, true);

  // Get online friends
  socket.on('get-online-users', (userIds, callback) => {
    if (typeof callback === 'function') {
      const online = userIds.filter(id => onlineUsers.has(id));
      callback(online);
    }
  });

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

  // Track recently seen users when joining voice channels
  socket.on('voice-join', ({ channelId }) => {
    const users = voiceState.get(channelId);
    if (users) {
      for (const u of [...users]) {
        if (u.userId !== socket.user.id) {
          updateRecentlySeen(socket.user.id, u.userId, u.username);
          updateRecentlySeen(u.userId, socket.user.id, socket.user.username);
        }
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`${socket.user.username} disconnected`);
    onlineUsers.delete(socket.user.id);
    broadcastOnlineStatus(socket.user.id, false);
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

// Broadcast online/offline to a user's friends
function broadcastOnlineStatus(userId, isOnline) {
  const friends = db().prepare(`
    SELECT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as friend_id
    FROM friendships WHERE (sender_id = ? OR receiver_id = ?) AND status = 'accepted'
  `).all(userId, userId, userId);

  for (const { friend_id } of friends) {
    const friendSocketId = onlineUsers.get(friend_id);
    if (friendSocketId) {
      io.to(friendSocketId).emit('friend-online-status', { userId, online: isOnline });
    }
  }
}

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
