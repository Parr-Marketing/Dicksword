import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const GITHUB_RELEASES = 'https://github.com/Parr-Marketing/Dicksword/releases/latest';
const DOWNLOAD_WIN = `${GITHUB_RELEASES}/download/Dicksword-Setup-1.0.0.exe`;
const DOWNLOAD_MAC = `${GITHUB_RELEASES}/download/Dicksword-1.0.0.dmg`;

export default function Login() {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isRegister) {
        await register(username, email, password);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="auth-container">
      <form className="auth-box" onSubmit={handleSubmit}>
        <h1>{isRegister ? 'Create an account' : 'Welcome back!'}</h1>
        <p className="subtitle">
          {isRegister ? 'Join the Dicksword revolution' : "We're so excited to see you again!"}
        </p>

        {error && <div className="error">{error}</div>}

        {isRegister && (
          <>
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoComplete="username"
            />
          </>
        )}

        <label>Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
        />

        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          minLength={6}
          autoComplete={isRegister ? 'new-password' : 'current-password'}
        />

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Loading...' : (isRegister ? 'Register' : 'Log In')}
        </button>

        <p className="auth-switch">
          {isRegister ? (
            <>Already have an account? <span onClick={() => { setIsRegister(false); setError(''); }}>Log In</span></>
          ) : (
            <>Need an account? <span onClick={() => { setIsRegister(true); setError(''); }}>Register</span></>
          )}
        </p>
      </form>

      {/* Download section */}
      <div className="download-section">
        <p className="download-title">Get the Desktop App</p>
        <div className="download-buttons">
          <a href={DOWNLOAD_WIN} className="download-btn windows" target="_blank" rel="noopener noreferrer">
            <span className="download-icon">🪟</span>
            <span className="download-text">
              <span className="download-label">Download for</span>
              <span className="download-platform">Windows</span>
            </span>
          </a>
          <a href={DOWNLOAD_MAC} className="download-btn mac" target="_blank" rel="noopener noreferrer">
            <span className="download-icon">🍎</span>
            <span className="download-text">
              <span className="download-label">Download for</span>
              <span className="download-platform">macOS</span>
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}
