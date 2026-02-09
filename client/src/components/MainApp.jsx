import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { VoiceManager } from '../utils/webrtc';

const API = '/api';

export default function MainApp() {
  const { user, token, logout } = useAuth();
  const socket = useSocket();

  // State
  const [servers, setServers] = useState([]);
  const [activeServer, setActiveServer] = useState(null);
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [showModal, setShowModal] = useState(null); // 'create' | 'join' | 'invite' | 'addChannel'
  const [modalInput, setModalInput] = useState('');
  const [modalType, setModalType] = useState('text');

  // Voice state
  const [voiceChannelId, setVoiceChannelId] = useState(null);
  const [voiceUsers, setVoiceUsers] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [screenShareStream, setScreenShareStream] = useState(null);
  const voiceManagerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const audioRefs = useRef({});

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Fetch servers
  useEffect(() => {
    fetch(`${API}/servers`, { headers }).then(r => r.json()).then(setServers);
  }, [token]);

  // Fetch channels when server changes
  useEffect(() => {
    if (!activeServer) return;
    fetch(`${API}/servers/${activeServer.id}/channels`, { headers }).then(r => r.json()).then(c => {
      setChannels(c);
      const textChannel = c.find(ch => ch.type === 'text');
      if (textChannel && !activeChannel) setActiveChannel(textChannel);
    });
    fetch(`${API}/servers/${activeServer.id}/members`, { headers }).then(r => r.json()).then(setMembers);
    if (socket) socket.emit('join-server', activeServer.id);
  }, [activeServer, token, socket]);

  // Fetch messages when channel changes
  useEffect(() => {
    if (!activeChannel || activeChannel.type !== 'text') { setMessages([]); return; }
    fetch(`${API}/channels/${activeChannel.id}/messages`, { headers }).then(r => r.json()).then(setMessages);
    if (socket) {
      socket.emit('join-channel', activeChannel.id);
      return () => socket.emit('leave-channel', activeChannel.id);
    }
  }, [activeChannel, token, socket]);

  // Listen for new messages
  useEffect(() => {
    if (!socket) return;
    const handler = (msg) => {
      if (msg.channel_id === activeChannel?.id) {
        setMessages(prev => [...prev, msg]);
      }
    };
    socket.on('new-message', handler);
    return () => socket.off('new-message', handler);
  }, [socket, activeChannel]);

  // Listen for voice state updates
  useEffect(() => {
    if (!socket) return;
    const handleJoin = ({ users }) => setVoiceUsers(users);
    const handleLeft = ({ users }) => setVoiceUsers(users);

    socket.on('voice-user-joined', handleJoin);
    socket.on('voice-user-left', handleLeft);
    return () => {
      socket.off('voice-user-joined', handleJoin);
      socket.off('voice-user-left', handleLeft);
    };
  }, [socket]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Play remote audio streams
  useEffect(() => {
    for (const [socketId, stream] of remoteStreams) {
      if (!audioRefs.current[socketId]) {
        const audio = new Audio();
        audio.srcObject = stream;
        audio.autoplay = true;
        audioRefs.current[socketId] = audio;
      }
    }
    // Clean up removed streams
    for (const socketId of Object.keys(audioRefs.current)) {
      if (!remoteStreams.has(socketId)) {
        audioRefs.current[socketId].pause();
        delete audioRefs.current[socketId];
      }
    }
  }, [remoteStreams]);

  // Send message
  const sendMessage = (e) => {
    e.preventDefault();
    if (!messageInput.trim() || !socket || !activeChannel) return;
    socket.emit('send-message', { channelId: activeChannel.id, content: messageInput.trim() });
    setMessageInput('');
  };

  // Create server
  const createServer = async () => {
    const res = await fetch(`${API}/servers`, {
      method: 'POST', headers, body: JSON.stringify({ name: modalInput })
    });
    const server = await res.json();
    setServers(prev => [...prev, { ...server, role: 'owner' }]);
    setActiveServer(server);
    setActiveChannel(null);
    setShowModal(null);
    setModalInput('');
  };

  // Join server
  const joinServer = async () => {
    const res = await fetch(`${API}/servers/join`, {
      method: 'POST', headers, body: JSON.stringify({ inviteCode: modalInput })
    });
    if (res.ok) {
      const server = await res.json();
      setServers(prev => {
        if (prev.find(s => s.id === server.id)) return prev;
        return [...prev, { ...server, role: 'member' }];
      });
      setActiveServer(server);
      setActiveChannel(null);
    }
    setShowModal(null);
    setModalInput('');
  };

  // Add channel
  const addChannel = async () => {
    const res = await fetch(`${API}/servers/${activeServer.id}/channels`, {
      method: 'POST', headers, body: JSON.stringify({ name: modalInput, type: modalType })
    });
    const channel = await res.json();
    setChannels(prev => [...prev, channel]);
    setShowModal(null);
    setModalInput('');
  };

  // Voice functions
  const joinVoice = async (channel) => {
    if (!socket) return;
    if (voiceManagerRef.current) {
      voiceManagerRef.current.destroy();
    }

    const vm = new VoiceManager(socket);
    vm.onRemoteStream = (socketId, stream) => {
      setRemoteStreams(prev => new Map(prev).set(socketId, stream));
    };
    vm.onRemoteStreamRemoved = (socketId) => {
      setRemoteStreams(prev => {
        const next = new Map(prev);
        next.delete(socketId);
        return next;
      });
    };

    voiceManagerRef.current = vm;
    const success = await vm.joinVoice(channel.id);
    if (success) {
      setVoiceChannelId(channel.id);
      setActiveChannel(channel);
    }
  };

  const leaveVoice = () => {
    if (voiceManagerRef.current) {
      voiceManagerRef.current.destroy();
      voiceManagerRef.current = null;
    }
    setVoiceChannelId(null);
    setVoiceUsers([]);
    setIsMuted(false);
    setIsScreenSharing(false);
    setRemoteStreams(new Map());
    // Clean up audio elements
    Object.values(audioRefs.current).forEach(a => a.pause());
    audioRefs.current = {};
  };

  const toggleMute = () => {
    if (voiceManagerRef.current) {
      const muted = voiceManagerRef.current.toggleMute();
      setIsMuted(muted);
    }
  };

  const toggleScreenShare = async () => {
    if (!voiceManagerRef.current) return;
    if (isScreenSharing) {
      voiceManagerRef.current.stopScreenShare();
      setIsScreenSharing(false);
      setScreenShareStream(null);
    } else {
      const stream = await voiceManagerRef.current.startScreenShare();
      if (stream) {
        setIsScreenSharing(true);
        setScreenShareStream(stream);
      }
    }
  };

  // Format timestamp
  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getInitials = (name) => name ? name.charAt(0).toUpperCase() : '?';

  const textChannels = channels.filter(c => c.type === 'text');
  const voiceChannels = channels.filter(c => c.type === 'voice');
  const activeVoiceChannel = channels.find(c => c.id === voiceChannelId);

  return (
    <div className="app-layout">
      {/* Server sidebar */}
      <div className="server-sidebar">
        {servers.map(s => (
          <div
            key={s.id}
            className={`server-icon ${activeServer?.id === s.id ? 'active' : ''}`}
            style={{ background: s.icon_color || '#5865F2' }}
            onClick={() => { setActiveServer(s); setActiveChannel(null); }}
            title={s.name}
          >
            {getInitials(s.name)}
          </div>
        ))}
        <div className="server-divider" />
        <button className="add-server-btn" onClick={() => setShowModal('create')} title="Create a Server">+</button>
        <button className="add-server-btn" onClick={() => setShowModal('join')} title="Join a Server" style={{ color: '#5865F2', fontSize: '20px' }}>↓</button>
      </div>

      {/* Channel sidebar */}
      {activeServer ? (
        <div className="channel-sidebar">
          <div className="channel-sidebar-header">{activeServer.name}</div>
          <div className="channel-list">
            {textChannels.length > 0 && (
              <>
                <div className="channel-category">Text Channels</div>
                {textChannels.map(c => (
                  <div
                    key={c.id}
                    className={`channel-item ${activeChannel?.id === c.id && activeChannel.type === 'text' ? 'active' : ''}`}
                    onClick={() => setActiveChannel(c)}
                  >
                    <span className="channel-icon">#</span>
                    <span className="channel-name">{c.name}</span>
                  </div>
                ))}
              </>
            )}
            {voiceChannels.length > 0 && (
              <>
                <div className="channel-category">Voice Channels</div>
                {voiceChannels.map(c => (
                  <div key={c.id}>
                    <div
                      className={`channel-item ${activeChannel?.id === c.id && activeChannel.type === 'voice' ? 'active' : ''}`}
                      onClick={() => {
                        setActiveChannel(c);
                        if (voiceChannelId !== c.id) joinVoice(c);
                      }}
                    >
                      <span className="channel-icon">🔊</span>
                      <span className="channel-name">{c.name}</span>
                    </div>
                    {voiceChannelId === c.id && voiceUsers.length > 0 && (
                      <div className="voice-users-list">
                        {voiceUsers.map(u => (
                          <div key={u.socketId} className="voice-user-item">
                            <div className="voice-user-avatar" style={{ background: '#5865F2' }}>
                              {getInitials(u.username)}
                            </div>
                            <span>{u.username}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
            <div
              className="channel-item"
              style={{ marginTop: 8, color: 'var(--text-muted)' }}
              onClick={() => { setShowModal('addChannel'); setModalInput(''); setModalType('text'); }}
            >
              <span className="channel-icon">+</span>
              <span className="channel-name">Add Channel</span>
            </div>
          </div>

          {/* Voice connection bar */}
          {voiceChannelId && (
            <div className="voice-connection-bar">
              <div className="voice-connection-info">
                <div>
                  <div className="voice-connection-status">Voice Connected</div>
                  <div className="voice-connection-channel">{activeVoiceChannel?.name || 'Voice'}</div>
                </div>
                <button className="voice-disconnect-btn" onClick={leaveVoice} title="Disconnect">
                  📞
                </button>
              </div>
            </div>
          )}

          {/* User panel */}
          <div className="user-panel">
            <div className="user-avatar" style={{ background: user.avatar_color }}>
              {getInitials(user.username)}
            </div>
            <div className="user-info">
              <div className="username">{user.username}</div>
              <div className="status">Online</div>
            </div>
            <button className="user-panel-btn" onClick={() => setShowModal('invite')} title="Invite">📋</button>
            <button className="user-panel-btn" onClick={logout} title="Log Out">🚪</button>
          </div>
        </div>
      ) : (
        <div className="channel-sidebar">
          <div className="channel-sidebar-header">Dicksword</div>
          <div className="channel-list" style={{ padding: 16 }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}>
              Create a server or join one with an invite code.
            </p>
            <button className="btn-primary" style={{ marginBottom: 8 }} onClick={() => setShowModal('create')}>Create a Server</button>
            <button className="btn-primary" style={{ background: 'var(--bg-tertiary)' }} onClick={() => setShowModal('join')}>Join a Server</button>
          </div>
          <div className="user-panel">
            <div className="user-avatar" style={{ background: user.avatar_color }}>
              {getInitials(user.username)}
            </div>
            <div className="user-info">
              <div className="username">{user.username}</div>
            </div>
            <button className="user-panel-btn" onClick={logout} title="Log Out">🚪</button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="main-content">
        {activeChannel ? (
          activeChannel.type === 'text' ? (
            <>
              <div className="main-header">
                <span className="channel-hash">#</span>
                <span className="channel-name">{activeChannel.name}</span>
              </div>
              <div className="messages-container">
                <div className="spacer" />
                {messages.map((msg, i) => {
                  const showHeader = i === 0 || messages[i - 1].user_id !== msg.user_id;
                  return (
                    <div key={msg.id} className={`message ${showHeader ? 'has-header' : ''}`}>
                      {showHeader ? (
                        <div className="message-avatar" style={{ background: msg.avatar_color || '#5865F2' }}>
                          {getInitials(msg.username)}
                        </div>
                      ) : (
                        <div style={{ width: 40 }} />
                      )}
                      <div className="message-content">
                        {showHeader && (
                          <div className="message-header">
                            <span className="message-author">{msg.username}</span>
                            <span className="message-timestamp">{formatTime(msg.created_at)}</span>
                          </div>
                        )}
                        <div className="message-text">{msg.content}</div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
              <div className="message-input-container">
                <form onSubmit={sendMessage} className="message-input-wrapper">
                  <input
                    className="message-input"
                    placeholder={`Message #${activeChannel.name}`}
                    value={messageInput}
                    onChange={e => setMessageInput(e.target.value)}
                  />
                </form>
              </div>
            </>
          ) : (
            <>
              <div className="main-header">
                <span className="channel-hash">🔊</span>
                <span className="channel-name">{activeChannel.name}</span>
              </div>
              <div className="voice-panel">
                {screenShareStream && (
                  <div className="screen-share-container">
                    <div className="screen-share-label">You are sharing your screen</div>
                    <video
                      autoPlay
                      muted
                      ref={el => { if (el) el.srcObject = screenShareStream; }}
                    />
                  </div>
                )}
                {!screenShareStream && (
                  <>
                    <h2>{activeChannel.name}</h2>
                    <div className="voice-participants">
                      {voiceUsers.map(u => (
                        <div key={u.socketId} className="voice-participant">
                          <div className="voice-participant-avatar" style={{ background: '#5865F2' }}>
                            {getInitials(u.username)}
                          </div>
                          <span className="voice-participant-name">
                            {u.username} {u.userId === user.id && '(You)'}
                          </span>
                        </div>
                      ))}
                      {voiceUsers.length === 0 && (
                        <p style={{ color: 'var(--text-muted)' }}>No one is in this voice channel</p>
                      )}
                    </div>
                  </>
                )}
                <div className="voice-controls">
                  {voiceChannelId === activeChannel.id ? (
                    <>
                      <button className={`voice-btn mute ${isMuted ? 'muted' : ''}`} onClick={toggleMute}>
                        {isMuted ? '🔇 Unmute' : '🎤 Mute'}
                      </button>
                      <button className={`voice-btn screen-share ${isScreenSharing ? 'sharing' : ''}`} onClick={toggleScreenShare}>
                        {isScreenSharing ? '⏹️ Stop Share' : '🖥️ Share Screen'}
                      </button>
                      <button className="voice-btn disconnect" onClick={leaveVoice}>
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button className="voice-btn connect" onClick={() => joinVoice(activeChannel)}>
                      🎤 Join Voice
                    </button>
                  )}
                </div>
              </div>
            </>
          )
        ) : (
          <div className="empty-state">
            <div className="icon">🗡️</div>
            <h2 style={{ color: 'var(--header-primary)' }}>Welcome to Dicksword</h2>
            <p>Select a channel to start chatting</p>
          </div>
        )}
      </div>

      {/* Members sidebar */}
      {activeServer && activeChannel?.type === 'text' && (
        <div className="members-sidebar">
          <div className="members-category">Members — {members.length}</div>
          {members.map(m => (
            <div key={m.id} className="member-item">
              <div className="member-avatar" style={{ background: m.avatar_color || '#5865F2' }}>
                {getInitials(m.username)}
              </div>
              <span className="member-name">{m.username}</span>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            {showModal === 'create' && (
              <>
                <h2>Create a Server</h2>
                <label>Server Name</label>
                <input
                  value={modalInput}
                  onChange={e => setModalInput(e.target.value)}
                  placeholder="My Awesome Server"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && modalInput && createServer()}
                />
                <div className="modal-buttons">
                  <button className="btn-cancel" onClick={() => setShowModal(null)}>Cancel</button>
                  <button className="btn-submit" onClick={createServer} disabled={!modalInput}>Create</button>
                </div>
              </>
            )}
            {showModal === 'join' && (
              <>
                <h2>Join a Server</h2>
                <label>Invite Code</label>
                <input
                  value={modalInput}
                  onChange={e => setModalInput(e.target.value)}
                  placeholder="Enter an invite code"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && modalInput && joinServer()}
                />
                <div className="modal-buttons">
                  <button className="btn-cancel" onClick={() => setShowModal(null)}>Cancel</button>
                  <button className="btn-submit" onClick={joinServer} disabled={!modalInput}>Join</button>
                </div>
              </>
            )}
            {showModal === 'invite' && activeServer && (
              <>
                <h2>Invite Friends</h2>
                <p style={{ color: 'var(--text-muted)', marginBottom: 12, fontSize: 14 }}>
                  Share this invite code with your friends:
                </p>
                <div className="invite-code">{activeServer.invite_code}</div>
                <p style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>Click to select, then copy</p>
                <div className="modal-buttons" style={{ marginTop: 16 }}>
                  <button className="btn-submit" onClick={() => {
                    navigator.clipboard.writeText(activeServer.invite_code);
                    setShowModal(null);
                  }}>Copy & Close</button>
                </div>
              </>
            )}
            {showModal === 'addChannel' && (
              <>
                <h2>Create Channel</h2>
                <label>Channel Type</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <button
                    className="btn-submit"
                    style={{ background: modalType === 'text' ? 'var(--brand-color)' : 'var(--bg-tertiary)', flex: 1 }}
                    onClick={() => setModalType('text')}
                  ># Text</button>
                  <button
                    className="btn-submit"
                    style={{ background: modalType === 'voice' ? 'var(--brand-color)' : 'var(--bg-tertiary)', flex: 1 }}
                    onClick={() => setModalType('voice')}
                  >🔊 Voice</button>
                </div>
                <label>Channel Name</label>
                <input
                  value={modalInput}
                  onChange={e => setModalInput(e.target.value)}
                  placeholder={modalType === 'text' ? 'general' : 'Voice Chat'}
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && modalInput && addChannel()}
                />
                <div className="modal-buttons">
                  <button className="btn-cancel" onClick={() => setShowModal(null)}>Cancel</button>
                  <button className="btn-submit" onClick={addChannel} disabled={!modalInput}>Create</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
