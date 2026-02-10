import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { VoiceManager } from '../utils/webrtc';
import Settings from './Settings';
import Friends from './Friends';
import ProfileCard from './ProfileCard';
import { compressServerIcon, compressServerBanner } from '../utils/imageCompression';

const API = '/api';

const DEFAULT_VOICE_SETTINGS = {
  inputDevice: '',
  outputDevice: '',
  inputVolume: 100,
  outputVolume: 100,
  pttEnabled: false,
  pttKey: 'Space',
  muteKey: '',
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};

function loadVoiceSettings() {
  try {
    const saved = localStorage.getItem('dicksword-voice-settings');
    return saved ? { ...DEFAULT_VOICE_SETTINGS, ...JSON.parse(saved) } : DEFAULT_VOICE_SETTINGS;
  } catch { return DEFAULT_VOICE_SETTINGS; }
}

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
  const [showModal, setShowModal] = useState(null);
  const [modalInput, setModalInput] = useState('');
  const [modalType, setModalType] = useState('text');
  const [showSettings, setShowSettings] = useState(false);
  const [mobileView, setMobileView] = useState('channels'); // 'channels' or 'chat'

  // Voice state
  const [voiceChannelId, setVoiceChannelId] = useState(null);
  const [voiceUsers, setVoiceUsers] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [screenShareStream, setScreenShareStream] = useState(null); // local share
  const [remoteScreenShare, setRemoteScreenShare] = useState(null); // { socketId, stream }
  const [voiceSettings, setVoiceSettings] = useState(loadVoiceSettings);
  const [userVolumes, setUserVolumes] = useState(() => {
    try {
      const saved = localStorage.getItem('dicksword-user-volumes');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [userMuted, setUserMuted] = useState(new Set());
  const [friendRequestsSent, setFriendRequestsSent] = useState(new Set());
  const [selectedProfileUserId, setSelectedProfileUserId] = useState(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const attachmentInputRef = useRef(null);
  const serverIconInputRef = useRef(null);
  const serverBannerInputRef = useRef(null);
  const voiceManagerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const audioRefs = useRef({}); // socketId -> { audio, ctx?, gain? }
  const voiceSettingsRef = useRef(voiceSettings);

  // Keep ref in sync
  useEffect(() => { voiceSettingsRef.current = voiceSettings; }, [voiceSettings]);

  // Persist per-user volumes
  useEffect(() => {
    localStorage.setItem('dicksword-user-volumes', JSON.stringify(userVolumes));
  }, [userVolumes]);

  const toggleUserMute = (userId) => {
    setUserMuted(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };

  const sendFriendRequestFromVoice = async (username) => {
    try {
      const res = await fetch(`${API}/friends/request`, {
        method: 'POST', headers, body: JSON.stringify({ username })
      });
      if (res.ok) {
        setFriendRequestsSent(prev => new Set(prev).add(username));
      }
    } catch {}
  };

  // Upload chat attachment
  const handleAttachmentSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !socket || !activeChannel) return;
    setAttachmentUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      if (res.ok) {
        const { url, type } = await res.json();
        socket.emit('send-message', {
          channelId: activeChannel.id,
          content: messageInput.trim() || '',
          attachmentUrl: url,
          attachmentType: type
        });
        setMessageInput('');
      }
    } catch (err) {
      console.error('Upload failed:', err);
    }
    setAttachmentUploading(false);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  };

  // Server customization
  const handleServerIconSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !activeServer) return;
    try {
      const dataUrl = await compressServerIcon(file);
      const res = await fetch(`${API}/servers/${activeServer.id}/customize`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ icon_url: dataUrl })
      });
      if (res.ok) {
        const updated = await res.json();
        setServers(prev => prev.map(s => s.id === updated.id ? { ...s, ...updated } : s));
        setActiveServer(prev => prev ? { ...prev, ...updated } : prev);
      }
    } catch (err) {
      console.error('Server icon upload failed:', err);
    }
  };

  const handleServerBannerSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !activeServer) return;
    try {
      const dataUrl = await compressServerBanner(file);
      const res = await fetch(`${API}/servers/${activeServer.id}/customize`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ banner_url: dataUrl })
      });
      if (res.ok) {
        const updated = await res.json();
        setServers(prev => prev.map(s => s.id === updated.id ? { ...s, ...updated } : s));
        setActiveServer(prev => prev ? { ...prev, ...updated } : prev);
      }
    } catch (err) {
      console.error('Server banner upload failed:', err);
    }
  };

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

  // Play remote audio streams with per-user gain control (supports 0-200% per user)
  useEffect(() => {
    const globalVol = isDeafened ? 0 : voiceSettings.outputVolume / 100;

    for (const [socketId, stream] of remoteStreams) {
      // Find userId for this socketId
      const vu = voiceUsers.find(u => u.socketId === socketId);
      const userId = vu?.userId;
      const perUserVol = (userId && userMuted.has(userId)) ? 0
        : ((userId && userVolumes[userId] !== undefined) ? userVolumes[userId] : 100) / 100;
      const finalGain = globalVol * perUserVol;

      if (!audioRefs.current[socketId]) {
        try {
          // Audio processing: source -> gain -> destination -> Audio element
          const ctx = new AudioContext();
          const source = ctx.createMediaStreamSource(stream);
          const gain = ctx.createGain();
          const dest = ctx.createMediaStreamDestination();
          gain.gain.value = finalGain;
          source.connect(gain);
          gain.connect(dest);

          const audio = new Audio();
          audio.srcObject = dest.stream;
          audio.autoplay = true;
          audio.volume = 1;
          if (voiceSettings.outputDevice && audio.setSinkId) {
            audio.setSinkId(voiceSettings.outputDevice).catch(() => {});
          }
          audioRefs.current[socketId] = { audio, ctx, gain };
        } catch (err) {
          // Fallback: simple Audio element without gain node
          const audio = new Audio();
          audio.srcObject = stream;
          audio.autoplay = true;
          audio.volume = Math.min(1, finalGain);
          if (voiceSettings.outputDevice && audio.setSinkId) {
            audio.setSinkId(voiceSettings.outputDevice).catch(() => {});
          }
          audioRefs.current[socketId] = { audio };
        }
      } else {
        // Update gain or volume
        const ref = audioRefs.current[socketId];
        if (ref.gain) {
          ref.gain.gain.value = finalGain;
        } else {
          ref.audio.volume = Math.min(1, finalGain);
        }
        // Update output device
        if (voiceSettings.outputDevice && ref.audio.setSinkId) {
          ref.audio.setSinkId(voiceSettings.outputDevice).catch(() => {});
        }
      }
    }

    // Cleanup removed streams
    for (const socketId of Object.keys(audioRefs.current)) {
      if (!remoteStreams.has(socketId)) {
        const ref = audioRefs.current[socketId];
        ref.audio.pause();
        if (ref.ctx) ref.ctx.close().catch(() => {});
        delete audioRefs.current[socketId];
      }
    }
  }, [remoteStreams, voiceSettings.outputVolume, voiceSettings.outputDevice, isDeafened, userVolumes, userMuted, voiceUsers]);

  // Push-to-talk
  useEffect(() => {
    if (!voiceSettings.pttEnabled || !voiceChannelId) return;
    const vm = voiceManagerRef.current;
    if (!vm || !vm.localStream) return;

    // Start muted when PTT is enabled
    const audioTrack = vm.localStream.getAudioTracks()[0];
    if (audioTrack) audioTrack.enabled = false;
    setIsMuted(true);

    const onKeyDown = (e) => {
      if (e.code === voiceSettingsRef.current.pttKey && audioTrack && !audioTrack.enabled) {
        audioTrack.enabled = true;
        setIsMuted(false);
      }
    };
    const onKeyUp = (e) => {
      if (e.code === voiceSettingsRef.current.pttKey && audioTrack) {
        audioTrack.enabled = false;
        setIsMuted(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [voiceSettings.pttEnabled, voiceSettings.pttKey, voiceChannelId]);

  // Mute toggle key
  useEffect(() => {
    const key = voiceSettingsRef.current.muteKey;
    if (!key || !voiceChannelId) return;
    // Don't use mute key if PTT is enabled (PTT handles mute)
    if (voiceSettingsRef.current.pttEnabled) return;

    const onKeyDown = (e) => {
      if (e.code === voiceSettingsRef.current.muteKey && voiceManagerRef.current) {
        const muted = voiceManagerRef.current.toggleMute();
        setIsMuted(muted);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [voiceSettings.muteKey, voiceSettings.pttEnabled, voiceChannelId]);

  // Apply input volume via gain node
  useEffect(() => {
    const vm = voiceManagerRef.current;
    if (!vm || !vm.localStream) return;
    if (vm.gainNode) {
      vm.gainNode.gain.value = voiceSettings.inputVolume / 100;
    }
  }, [voiceSettings.inputVolume]);

  // ESC to close settings
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && showSettings) setShowSettings(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showSettings]);

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
    vm.onScreenShareReceived = (socketId, stream) => {
      setRemoteScreenShare({ socketId, stream });
    };
    vm.onScreenShareStopped = () => {
      setRemoteScreenShare(null);
    };

    voiceManagerRef.current = vm;
    const success = await vm.joinVoice(channel.id, {
      inputDevice: voiceSettings.inputDevice,
      inputVolume: voiceSettings.inputVolume,
      noiseSuppression: voiceSettings.noiseSuppression,
      echoCancellation: voiceSettings.echoCancellation,
      autoGainControl: voiceSettings.autoGainControl,
    });
    if (success) {
      setVoiceChannelId(channel.id);
      setActiveChannel(channel);
      // If PTT is enabled, start muted
      if (voiceSettings.pttEnabled) {
        const track = vm.localStream?.getAudioTracks()[0];
        if (track) track.enabled = false;
        setIsMuted(true);
      }
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
    setIsDeafened(false);
    setIsScreenSharing(false);
    setScreenShareStream(null);
    setRemoteScreenShare(null);
    setRemoteStreams(new Map());
    setFriendRequestsSent(new Set());
    for (const ref of Object.values(audioRefs.current)) {
      ref.audio.pause();
      if (ref.ctx) ref.ctx.close().catch(() => {});
    }
    audioRefs.current = {};
  };

  const toggleMute = () => {
    if (voiceSettings.pttEnabled) return; // PTT handles mute
    if (voiceManagerRef.current) {
      const muted = voiceManagerRef.current.toggleMute();
      setIsMuted(muted);
    }
  };

  const toggleDeafen = () => {
    const newDeafened = !isDeafened;
    setIsDeafened(newDeafened);
    // If deafening, also mute mic. If undeafening, unmute mic.
    if (newDeafened && !isMuted && voiceManagerRef.current && !voiceSettings.pttEnabled) {
      voiceManagerRef.current.toggleMute();
      setIsMuted(true);
    }
    if (!newDeafened && isMuted && voiceManagerRef.current && !voiceSettings.pttEnabled) {
      voiceManagerRef.current.toggleMute();
      setIsMuted(false);
    }
  };

  const stopScreenShare = useCallback(() => {
    if (voiceManagerRef.current) {
      voiceManagerRef.current.stopScreenShare();
    }
    setIsScreenSharing(false);
    setScreenShareStream(null);
  }, []);

  const startScreenShare = async () => {
    if (!voiceManagerRef.current) return;
    const stream = await voiceManagerRef.current.startScreenShare();
    if (stream) {
      setIsScreenSharing(true);
      setScreenShareStream(stream);
      // Auto-stop when the browser's native "stop sharing" fires
      stream.getVideoTracks()[0].onended = () => stopScreenShare();
    }
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getInitials = (name) => name ? name.charAt(0).toUpperCase() : '?';

  const textChannels = channels.filter(c => c.type === 'text');
  const voiceChannels = channels.filter(c => c.type === 'voice');
  const activeVoiceChannel = channels.find(c => c.id === voiceChannelId);

  return (
    <div className={`app-layout ${mobileView === 'chat' ? 'mobile-chat-view' : 'mobile-channels-view'}`}>
      {/* Settings overlay */}
      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          voiceSettings={voiceSettings}
          onVoiceSettingsChange={setVoiceSettings}
        />
      )}

      {/* Server sidebar */}
      <div className="server-sidebar">
        <div
          className={`server-icon home-icon ${!activeServer ? 'active' : ''}`}
          style={{ background: '#5865F2' }}
          onClick={() => { setActiveServer(null); setActiveChannel(null); setMobileView('chat'); }}
          title="Home"
        >🗡️</div>
        <div className="server-divider" />
        {servers.map(s => (
          <div
            key={s.id}
            className={`server-icon ${activeServer?.id === s.id ? 'active' : ''}`}
            style={{ background: s.icon_color || '#5865F2' }}
            onClick={() => { setActiveServer(s); setActiveChannel(null); }}
            title={s.name}
          >
            {s.icon_url ? <img src={s.icon_url} className="avatar-img" alt={s.name} /> : getInitials(s.name)}
          </div>
        ))}
        <div className="server-divider" />
        <button className="add-server-btn" onClick={() => setShowModal('create')} title="Create a Server">+</button>
        <button className="add-server-btn" onClick={() => setShowModal('join')} title="Join a Server" style={{ color: '#5865F2', fontSize: '20px' }}>↓</button>
      </div>

      {/* Channel sidebar */}
      {activeServer ? (
        <div className="channel-sidebar">
          {activeServer.banner_url && (
            <div className="server-banner">
              <img src={activeServer.banner_url} alt="Server banner" />
            </div>
          )}
          <div className="channel-sidebar-header">
            <span style={{ flex: 1 }}>{activeServer.name}</span>
            <button className="server-customize-btn" onClick={() => setShowModal('invite')} title="Invite People">👥+</button>
            {activeServer.owner_id === user.id && (
              <button className="server-customize-btn" onClick={() => setShowModal('serverCustomize')} title="Customize Server">⚙️</button>
            )}
          </div>
          <div className="channel-list">
            {textChannels.length > 0 && (
              <>
                <div className="channel-category">Text Channels</div>
                {textChannels.map(c => (
                  <div
                    key={c.id}
                    className={`channel-item ${activeChannel?.id === c.id && activeChannel.type === 'text' ? 'active' : ''}`}
                    onClick={() => { setActiveChannel(c); setMobileView('chat'); }}
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
                        setMobileView('chat');
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
            <div className="user-avatar" style={{ background: user.avatar_color }} onClick={() => setSelectedProfileUserId(user.id)}>
              {user.avatar_url ? <img src={user.avatar_url} className="avatar-img" alt="" /> : getInitials(user.username)}
            </div>
            <div className="user-info">
              <div className="username">{user.username}</div>
              <div className="status">Online</div>
            </div>
            <button
              className={`user-panel-btn ${isMuted ? 'active-red' : ''}`}
              onClick={toggleMute}
              title={isMuted ? 'Unmute' : 'Mute'}
              disabled={!voiceChannelId}
              style={!voiceChannelId ? { opacity: 0.3 } : {}}
            >
              {isMuted ? '🔇' : '🎤'}
            </button>
            <button
              className={`user-panel-btn ${isDeafened ? 'active-red' : ''}`}
              onClick={toggleDeafen}
              title={isDeafened ? 'Undeafen' : 'Deafen'}
              disabled={!voiceChannelId}
              style={!voiceChannelId ? { opacity: 0.3 } : {}}
            >
              {isDeafened ? '🔕' : '🎧'}
            </button>
            <button className="user-panel-btn" onClick={() => setShowSettings(true)} title="Settings">⚙️</button>
          </div>
        </div>
      ) : (
        <div className="channel-sidebar">
          <div className="channel-sidebar-header">Dicksword</div>
          <div className="channel-list">
            <div
              className="channel-item active"
              style={{ marginTop: 8 }}
            >
              <span className="channel-icon">👥</span>
              <span className="channel-name">Friends</span>
            </div>
          </div>
          <div className="user-panel">
            <div className="user-avatar" style={{ background: user.avatar_color }} onClick={() => setSelectedProfileUserId(user.id)}>
              {user.avatar_url ? <img src={user.avatar_url} className="avatar-img" alt="" /> : getInitials(user.username)}
            </div>
            <div className="user-info">
              <div className="username">{user.username}</div>
            </div>
            <button
              className={`user-panel-btn ${isMuted ? 'active-red' : ''}`}
              onClick={toggleMute}
              title={isMuted ? 'Unmute' : 'Mute'}
              disabled={!voiceChannelId}
              style={!voiceChannelId ? { opacity: 0.3 } : {}}
            >
              {isMuted ? '🔇' : '🎤'}
            </button>
            <button
              className={`user-panel-btn ${isDeafened ? 'active-red' : ''}`}
              onClick={toggleDeafen}
              title={isDeafened ? 'Undeafen' : 'Deafen'}
              disabled={!voiceChannelId}
              style={!voiceChannelId ? { opacity: 0.3 } : {}}
            >
              {isDeafened ? '🔕' : '🎧'}
            </button>
            <button className="user-panel-btn" onClick={() => setShowSettings(true)} title="Settings">⚙️</button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="main-content">
        {activeChannel ? (
          activeChannel.type === 'text' ? (
            <>
              <div className="main-header">
                <button className="mobile-back-btn" onClick={() => setMobileView('channels')}>←</button>
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
                        <div className="message-avatar" style={{ background: msg.avatar_color || '#5865F2' }} onClick={() => setSelectedProfileUserId(msg.user_id)}>
                          {msg.avatar_url ? <img src={msg.avatar_url} className="avatar-img" alt="" /> : getInitials(msg.username)}
                        </div>
                      ) : (
                        <div style={{ width: 40 }} />
                      )}
                      <div className="message-content">
                        {showHeader && (
                          <div className="message-header">
                            <span className="message-author" onClick={() => setSelectedProfileUserId(msg.user_id)} style={{ cursor: 'pointer' }}>{msg.username}</span>
                            <span className="message-timestamp">{formatTime(msg.created_at)}</span>
                          </div>
                        )}
                        {msg.content && <div className="message-text">{msg.content}</div>}
                        {msg.attachment_url && (
                          <div className="message-attachment">
                            {(msg.attachment_type === 'image' || msg.attachment_type === 'gif') && (
                              <img src={msg.attachment_url} alt="attachment" onClick={(e) => { e.target.classList.toggle('expanded'); }} />
                            )}
                            {msg.attachment_type === 'video' && (
                              <video controls preload="metadata" src={msg.attachment_url} />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
              <div className="message-input-container">
                <form onSubmit={sendMessage} className="message-input-wrapper">
                  <button type="button" className="attachment-btn" onClick={() => attachmentInputRef.current?.click()} disabled={attachmentUploading} title="Upload file">
                    {attachmentUploading ? '⏳' : '📎'}
                  </button>
                  <input
                    className="message-input"
                    placeholder={`Message #${activeChannel.name}`}
                    value={messageInput}
                    onChange={e => setMessageInput(e.target.value)}
                  />
                  <input ref={attachmentInputRef} type="file" accept="image/*,video/*,.gif" onChange={handleAttachmentSelect} style={{ display: 'none' }} />
                </form>
              </div>
            </>
          ) : (
            <>
              <div className="main-header">
                <button className="mobile-back-btn" onClick={() => setMobileView('channels')}>←</button>
                <span className="channel-hash">🔊</span>
                <span className="channel-name">{activeChannel.name}</span>
              </div>
              <div className="voice-panel">
                {/* Local screen share preview */}
                {screenShareStream && (
                  <div className="screen-share-container">
                    <div className="screen-share-label">You are sharing your screen</div>
                    <video autoPlay muted ref={el => { if (el) el.srcObject = screenShareStream; }} />
                    <button className="voice-btn disconnect" style={{ marginTop: 12 }} onClick={stopScreenShare}>
                      ⏹️ Stop Sharing
                    </button>
                  </div>
                )}
                {/* Remote screen share */}
                {!screenShareStream && remoteScreenShare && (
                  <div className="screen-share-container">
                    <div className="screen-share-label">Someone is sharing their screen</div>
                    <video autoPlay ref={el => { if (el) el.srcObject = remoteScreenShare.stream; }} />
                  </div>
                )}
                {/* Voice participants with per-user controls */}
                {!screenShareStream && !remoteScreenShare && (
                  <>
                    <h2>{activeChannel.name}</h2>
                    <div className="voice-participants-list">
                      {voiceUsers.map(u => (
                        <div key={u.socketId} className="voice-participant-row">
                          <div className="voice-participant-avatar" style={{ background: '#5865F2', width: 40, height: 40, fontSize: 16 }}>
                            {getInitials(u.username)}
                          </div>
                          <div className="voice-participant-details">
                            <span className="voice-participant-name">
                              {u.username} {u.userId === user.id && '(You)'}
                            </span>
                            {u.userId !== user.id && voiceChannelId && (
                              <div className="voice-user-controls">
                                <div className="voice-user-volume">
                                  <button
                                    className={`voice-user-btn ${userMuted.has(u.userId) ? 'muted' : ''}`}
                                    onClick={() => toggleUserMute(u.userId)}
                                    title={userMuted.has(u.userId) ? 'Unmute User' : 'Mute User'}
                                  >
                                    {userMuted.has(u.userId) ? '🔇' : '🔊'}
                                  </button>
                                  <input
                                    type="range"
                                    className="user-volume-slider"
                                    min="0"
                                    max="200"
                                    value={userMuted.has(u.userId) ? 0 : (userVolumes[u.userId] ?? 100)}
                                    onChange={e => {
                                      const val = parseInt(e.target.value);
                                      setUserVolumes(prev => ({ ...prev, [u.userId]: val }));
                                      if (val > 0 && userMuted.has(u.userId)) {
                                        setUserMuted(prev => { const n = new Set(prev); n.delete(u.userId); return n; });
                                      }
                                    }}
                                  />
                                  <span className="user-volume-label">
                                    {userMuted.has(u.userId) ? 0 : (userVolumes[u.userId] ?? 100)}%
                                  </span>
                                </div>
                                <button
                                  className={`voice-user-btn add-friend ${friendRequestsSent.has(u.username) ? 'sent' : ''}`}
                                  onClick={() => sendFriendRequestFromVoice(u.username)}
                                  title={friendRequestsSent.has(u.username) ? 'Request Sent' : 'Add Friend'}
                                  disabled={friendRequestsSent.has(u.username)}
                                >
                                  {friendRequestsSent.has(u.username) ? '✓' : '👤+'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      {voiceUsers.length === 0 && (
                        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>No one is in this voice channel</p>
                      )}
                    </div>
                  </>
                )}
                {/* Voice controls - always visible */}
                <div className="voice-controls">
                  {voiceChannelId === activeChannel.id ? (
                    <>
                      <button className={`voice-btn mute ${isMuted ? 'muted' : ''}`} onClick={toggleMute}>
                        {voiceSettings.pttEnabled
                          ? (isMuted ? '🔇 PTT Off' : '🎤 PTT On')
                          : (isMuted ? '🔇 Unmute' : '🎤 Mute')}
                      </button>
                      {!isScreenSharing ? (
                        <button className="voice-btn screen-share" onClick={startScreenShare}>
                          🖥️ Share Screen
                        </button>
                      ) : (
                        <button className="voice-btn screen-share sharing" onClick={stopScreenShare}>
                          ⏹️ Stop Share
                        </button>
                      )}
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
        ) : !activeServer ? (
          <Friends onBack={() => setMobileView('channels')} />
        ) : (
          <div className="empty-state">
            <div className="icon">🗡️</div>
            <h2 style={{ color: 'var(--header-primary)' }}>Select a channel</h2>
            <p>Pick a text or voice channel to get started</p>
          </div>
        )}
      </div>

      {/* Members sidebar */}
      {activeServer && activeChannel?.type === 'text' && (
        <div className="members-sidebar">
          <div className="members-category">Members — {members.length}</div>
          {members.map(m => (
            <div key={m.id} className="member-item" onClick={() => setSelectedProfileUserId(m.id)}>
              <div className="member-avatar" style={{ background: m.avatar_color || '#5865F2' }}>
                {m.avatar_url ? <img src={m.avatar_url} className="avatar-img" alt="" /> : getInitials(m.username)}
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
                <input value={modalInput} onChange={e => setModalInput(e.target.value)} placeholder="My Awesome Server" autoFocus onKeyDown={e => e.key === 'Enter' && modalInput && createServer()} />
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
                <input value={modalInput} onChange={e => setModalInput(e.target.value)} placeholder="Enter an invite code" autoFocus onKeyDown={e => e.key === 'Enter' && modalInput && joinServer()} />
                <div className="modal-buttons">
                  <button className="btn-cancel" onClick={() => setShowModal(null)}>Cancel</button>
                  <button className="btn-submit" onClick={joinServer} disabled={!modalInput}>Join</button>
                </div>
              </>
            )}
            {showModal === 'invite' && activeServer && (
              <>
                <h2>Invite Friends</h2>
                <p style={{ color: 'var(--text-muted)', marginBottom: 12, fontSize: 14 }}>Share this invite code with your friends:</p>
                <div className="invite-code">{activeServer.invite_code}</div>
                <p style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>Click to select, then copy</p>
                <div className="modal-buttons" style={{ marginTop: 16 }}>
                  <button className="btn-submit" onClick={() => { navigator.clipboard.writeText(activeServer.invite_code); setShowModal(null); }}>Copy & Close</button>
                </div>
              </>
            )}
            {showModal === 'serverCustomize' && activeServer && (
              <>
                <h2>Customize Server</h2>
                <div className="settings-field">
                  <label>Server Icon (128×128, max 100KB)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div className="server-icon" style={{ background: activeServer.icon_color || '#5865F2', width: 64, height: 64, fontSize: 28, cursor: 'pointer' }} onClick={() => serverIconInputRef.current?.click()}>
                      {activeServer.icon_url ? <img src={activeServer.icon_url} className="avatar-img" alt="" /> : getInitials(activeServer.name)}
                    </div>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Click to change</span>
                  </div>
                  <input ref={serverIconInputRef} type="file" accept="image/*" onChange={handleServerIconSelect} style={{ display: 'none' }} />
                </div>
                <div className="settings-field">
                  <label>Server Banner (600×240, max 300KB)</label>
                  <div
                    className="profile-upload-zone banner-zone"
                    onClick={() => serverBannerInputRef.current?.click()}
                    style={
                      activeServer.banner_url
                        ? { backgroundImage: `url(${activeServer.banner_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                        : { background: `linear-gradient(135deg, ${activeServer.icon_color || '#5865F2'}, #2b2d31)` }
                    }
                  >
                    {!activeServer.banner_url && <span className="upload-hint">Click to upload banner</span>}
                  </div>
                  <input ref={serverBannerInputRef} type="file" accept="image/*" onChange={handleServerBannerSelect} style={{ display: 'none' }} />
                </div>
                <div className="modal-buttons">
                  <button className="btn-submit" onClick={() => setShowModal(null)}>Done</button>
                </div>
              </>
            )}
            {showModal === 'addChannel' && (
              <>
                <h2>Create Channel</h2>
                <label>Channel Type</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <button className="btn-submit" style={{ background: modalType === 'text' ? 'var(--brand-color)' : 'var(--bg-tertiary)', flex: 1 }} onClick={() => setModalType('text')}># Text</button>
                  <button className="btn-submit" style={{ background: modalType === 'voice' ? 'var(--brand-color)' : 'var(--bg-tertiary)', flex: 1 }} onClick={() => setModalType('voice')}>🔊 Voice</button>
                </div>
                <label>Channel Name</label>
                <input value={modalInput} onChange={e => setModalInput(e.target.value)} placeholder={modalType === 'text' ? 'general' : 'Voice Chat'} autoFocus onKeyDown={e => e.key === 'Enter' && modalInput && addChannel()} />
                <div className="modal-buttons">
                  <button className="btn-cancel" onClick={() => setShowModal(null)}>Cancel</button>
                  <button className="btn-submit" onClick={addChannel} disabled={!modalInput}>Create</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Profile Card */}
      {selectedProfileUserId && (
        <ProfileCard userId={selectedProfileUserId} onClose={() => setSelectedProfileUserId(null)} />
      )}
    </div>
  );
}
