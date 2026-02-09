// WebRTC signaling for voice channels
function setupSignaling(io, socket, voiceState) {

  // Join voice channel
  socket.on('voice-join', ({ channelId }) => {
    socket.join(`voice:${channelId}`);

    // Track user in voice state
    if (!voiceState.has(channelId)) {
      voiceState.set(channelId, new Set());
    }

    const userEntry = {
      socketId: socket.id,
      userId: socket.user.id,
      username: socket.user.username
    };

    voiceState.get(channelId).add(userEntry);

    // Tell everyone in the channel about the new user
    const users = [...voiceState.get(channelId)];
    io.to(`voice:${channelId}`).emit('voice-user-joined', {
      userId: socket.user.id,
      username: socket.user.username,
      socketId: socket.id,
      users
    });

    // Tell the new user about existing peers (so they can create offers)
    const existingPeers = users.filter(u => u.socketId !== socket.id);
    socket.emit('voice-existing-peers', existingPeers);
  });

  // Leave voice channel
  socket.on('voice-leave', ({ channelId }) => {
    socket.leave(`voice:${channelId}`);

    if (voiceState.has(channelId)) {
      const users = voiceState.get(channelId);
      const user = [...users].find(u => u.socketId === socket.id);
      if (user) {
        users.delete(user);
        if (users.size === 0) voiceState.delete(channelId);
      }
    }

    io.to(`voice:${channelId}`).emit('voice-user-left', {
      userId: socket.user.id,
      username: socket.user.username,
      users: [...(voiceState.get(channelId) || [])]
    });
  });

  // WebRTC offer
  socket.on('voice-offer', ({ to, offer }) => {
    io.to(to).emit('voice-offer', {
      from: socket.id,
      offer,
      userId: socket.user.id,
      username: socket.user.username
    });
  });

  // WebRTC answer
  socket.on('voice-answer', ({ to, answer }) => {
    io.to(to).emit('voice-answer', {
      from: socket.id,
      answer
    });
  });

  // ICE candidate
  socket.on('voice-ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('voice-ice-candidate', {
      from: socket.id,
      candidate
    });
  });

  // Get voice channel users
  socket.on('voice-get-users', ({ channelId }) => {
    const users = voiceState.has(channelId) ? [...voiceState.get(channelId)] : [];
    socket.emit('voice-users', { channelId, users });
  });

  // Screen share signaling
  socket.on('screen-share-start', ({ channelId }) => {
    io.to(`voice:${channelId}`).emit('screen-share-started', {
      userId: socket.user.id,
      username: socket.user.username,
      socketId: socket.id
    });
  });

  socket.on('screen-share-stop', ({ channelId }) => {
    io.to(`voice:${channelId}`).emit('screen-share-stopped', {
      userId: socket.user.id
    });
  });
}

module.exports = { setupSignaling };
