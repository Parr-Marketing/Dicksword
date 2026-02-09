import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

const API = '/api';

export default function Friends() {
  const { token } = useAuth();
  const socket = useSocket();
  const [tab, setTab] = useState('online'); // online | all | pending | add
  const [friends, setFriends] = useState([]);
  const [pending, setPending] = useState([]);
  const [onlineIds, setOnlineIds] = useState(new Set());
  const [addInput, setAddInput] = useState('');
  const [addMsg, setAddMsg] = useState({ text: '', ok: false });
  const [search, setSearch] = useState('');

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchFriends = useCallback(async () => {
    const res = await fetch(`${API}/friends`, { headers });
    const data = await res.json();
    setFriends(data);
    // Check who's online
    if (socket && data.length > 0) {
      const ids = data.map(f => f.id);
      socket.emit('get-online-users', ids, (online) => {
        setOnlineIds(new Set(online));
      });
    }
  }, [token, socket]);

  const fetchPending = useCallback(async () => {
    const res = await fetch(`${API}/friends/pending`, { headers });
    setPending(await res.json());
  }, [token]);

  useEffect(() => {
    fetchFriends();
    fetchPending();
  }, [fetchFriends, fetchPending]);

  // Listen for real-time friend events
  useEffect(() => {
    if (!socket) return;
    const onStatus = ({ userId, online }) => {
      setOnlineIds(prev => {
        const next = new Set(prev);
        if (online) next.add(userId); else next.delete(userId);
        return next;
      });
    };
    const onRequest = () => fetchPending();
    const onAccepted = () => { fetchFriends(); fetchPending(); };

    socket.on('friend-online-status', onStatus);
    socket.on('friend-request-received', onRequest);
    socket.on('friend-request-accepted', onAccepted);
    return () => {
      socket.off('friend-online-status', onStatus);
      socket.off('friend-request-received', onRequest);
      socket.off('friend-request-accepted', onAccepted);
    };
  }, [socket, fetchFriends, fetchPending]);

  const sendRequest = async () => {
    if (!addInput.trim()) return;
    try {
      const res = await fetch(`${API}/friends/request`, {
        method: 'POST', headers, body: JSON.stringify({ username: addInput.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        setAddMsg({ text: `Friend request sent to ${addInput}!`, ok: true });
        setAddInput('');
        fetchPending();
      } else {
        setAddMsg({ text: data.error || 'Failed', ok: false });
      }
    } catch { setAddMsg({ text: 'Network error', ok: false }); }
    setTimeout(() => setAddMsg({ text: '', ok: false }), 3000);
  };

  const acceptRequest = async (friendshipId) => {
    await fetch(`${API}/friends/accept`, { method: 'POST', headers, body: JSON.stringify({ friendshipId }) });
    fetchFriends(); fetchPending();
  };

  const rejectRequest = async (friendshipId) => {
    await fetch(`${API}/friends/reject`, { method: 'POST', headers, body: JSON.stringify({ friendshipId }) });
    fetchPending();
  };

  const removeFriend = async (friendshipId) => {
    await fetch(`${API}/friends/${friendshipId}`, { method: 'DELETE', headers });
    fetchFriends();
  };

  const onlineFriends = friends.filter(f => onlineIds.has(f.id));
  const filteredFriends = (tab === 'online' ? onlineFriends : friends)
    .filter(f => !search || f.username.toLowerCase().includes(search.toLowerCase()));
  const incomingPending = pending.filter(p => p.direction === 'incoming');
  const outgoingPending = pending.filter(p => p.direction === 'outgoing');

  const getInitials = (name) => name ? name.charAt(0).toUpperCase() : '?';

  return (
    <div className="friends-page">
      {/* Header */}
      <div className="friends-header">
        <span className="friends-header-icon">👥</span>
        <span className="friends-header-title">Friends</span>
        <div className="friends-tabs">
          <button className={`friends-tab ${tab === 'online' ? 'active' : ''}`} onClick={() => setTab('online')}>Online</button>
          <button className={`friends-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>All</button>
          <button className={`friends-tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
            Pending
            {incomingPending.length > 0 && <span className="friends-badge">{incomingPending.length}</span>}
          </button>
          <button className="friends-tab add-btn" onClick={() => setTab('add')}>Add Friend</button>
        </div>
      </div>

      <div className="friends-body">
        {/* Add Friend tab */}
        {tab === 'add' && (
          <div className="friends-add-section">
            <h3>Add Friend</h3>
            <p className="friends-add-desc">You can add friends by their Dicksword username.</p>
            <div className="friends-add-form">
              <input
                value={addInput}
                onChange={e => setAddInput(e.target.value)}
                placeholder="Enter a username"
                onKeyDown={e => e.key === 'Enter' && sendRequest()}
              />
              <button className="btn-submit" onClick={sendRequest} disabled={!addInput.trim()}>
                Send Request
              </button>
            </div>
            {addMsg.text && (
              <p className="friends-add-msg" style={{ color: addMsg.ok ? 'var(--green)' : 'var(--red)' }}>
                {addMsg.text}
              </p>
            )}
          </div>
        )}

        {/* Pending tab */}
        {tab === 'pending' && (
          <>
            {incomingPending.length > 0 && (
              <>
                <div className="friends-list-header">Incoming — {incomingPending.length}</div>
                {incomingPending.map(p => (
                  <div key={p.friendship_id} className="friend-item">
                    <div className="friend-avatar" style={{ background: p.avatar_color || '#5865F2' }}>
                      {getInitials(p.username)}
                    </div>
                    <div className="friend-info">
                      <span className="friend-name">{p.username}</span>
                      <span className="friend-status">Incoming Friend Request</span>
                    </div>
                    <div className="friend-actions">
                      <button className="friend-action-btn accept" onClick={() => acceptRequest(p.friendship_id)} title="Accept">✓</button>
                      <button className="friend-action-btn reject" onClick={() => rejectRequest(p.friendship_id)} title="Reject">✕</button>
                    </div>
                  </div>
                ))}
              </>
            )}
            {outgoingPending.length > 0 && (
              <>
                <div className="friends-list-header">Outgoing — {outgoingPending.length}</div>
                {outgoingPending.map(p => (
                  <div key={p.friendship_id} className="friend-item">
                    <div className="friend-avatar" style={{ background: p.avatar_color || '#5865F2' }}>
                      {getInitials(p.username)}
                    </div>
                    <div className="friend-info">
                      <span className="friend-name">{p.username}</span>
                      <span className="friend-status">Outgoing Friend Request</span>
                    </div>
                    <div className="friend-actions">
                      <button className="friend-action-btn reject" onClick={() => rejectRequest(p.friendship_id)} title="Cancel">✕</button>
                    </div>
                  </div>
                ))}
              </>
            )}
            {pending.length === 0 && (
              <div className="friends-empty">No pending friend requests</div>
            )}
          </>
        )}

        {/* Online / All tabs */}
        {(tab === 'online' || tab === 'all') && (
          <>
            <div className="friends-search-bar">
              <input
                placeholder="Search"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="friends-list-header">
              {tab === 'online' ? `Online — ${onlineFriends.length}` : `All Friends — ${friends.length}`}
            </div>
            {filteredFriends.map(f => (
              <div key={f.friendship_id} className="friend-item">
                <div className="friend-avatar-wrapper">
                  <div className="friend-avatar" style={{ background: f.avatar_color || '#5865F2' }}>
                    {getInitials(f.username)}
                  </div>
                  <span className={`friend-online-dot ${onlineIds.has(f.id) ? 'online' : 'offline'}`} />
                </div>
                <div className="friend-info">
                  <span className="friend-name">{f.username}</span>
                  <span className="friend-status">{onlineIds.has(f.id) ? 'Online' : 'Offline'}</span>
                </div>
                <div className="friend-actions">
                  <button className="friend-action-btn reject" onClick={() => removeFriend(f.friendship_id)} title="Remove Friend">✕</button>
                </div>
              </div>
            ))}
            {filteredFriends.length === 0 && (
              <div className="friends-empty">
                {tab === 'online' ? 'No friends online right now' : 'No friends yet. Add some!'}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
