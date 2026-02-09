import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

const API = '/api';

export default function ProfileCard({ userId, onClose }) {
  const { token } = useAuth();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!userId) return;
    fetch(`${API}/users/${userId}/profile`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(setProfile)
      .catch(() => {});
  }, [userId, token]);

  if (!profile) return null;

  const getInitials = (name) => name ? name.charAt(0).toUpperCase() : '?';

  const memberSince = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <div className="profile-modal-overlay" onClick={onClose}>
      <div className="profile-modal" onClick={e => e.stopPropagation()}>
        {/* Banner */}
        <div className="profile-banner" style={!profile.banner_url ? { background: profile.avatar_color || '#5865F2' } : {}}>
          {profile.banner_url && <img src={profile.banner_url} alt="Banner" />}
        </div>

        {/* Avatar */}
        <div className="profile-avatar-large" style={{ background: profile.avatar_color || '#5865F2' }}>
          {profile.avatar_url
            ? <img src={profile.avatar_url} alt={profile.username} className="avatar-img" />
            : getInitials(profile.username)
          }
        </div>

        {/* Info */}
        <div className="profile-info">
          <h3 className="profile-username">{profile.username}</h3>
          <div className="profile-meta">
            <span>Member since {memberSince}</span>
          </div>
        </div>

        <button className="profile-close-btn" onClick={onClose}>✕</button>
      </div>
    </div>
  );
}
