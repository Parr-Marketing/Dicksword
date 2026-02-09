import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

const API = '/api';

export default function Settings({ onClose, voiceSettings, onVoiceSettingsChange }) {
  const { user, token } = useAuth();
  const [activeTab, setActiveTab] = useState('account');

  // Account state
  const [username, setUsername] = useState(user?.username || '');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Audio device state
  const [inputDevices, setInputDevices] = useState([]);
  const [outputDevices, setOutputDevices] = useState([]);

  // Local copies of voice settings
  const [inputDevice, setInputDevice] = useState(voiceSettings.inputDevice);
  const [outputDevice, setOutputDevice] = useState(voiceSettings.outputDevice);
  const [inputVolume, setInputVolume] = useState(voiceSettings.inputVolume);
  const [outputVolume, setOutputVolume] = useState(voiceSettings.outputVolume);
  const [pttEnabled, setPttEnabled] = useState(voiceSettings.pttEnabled);
  const [pttKey, setPttKey] = useState(voiceSettings.pttKey);
  const [listeningForKey, setListeningForKey] = useState(false);

  // Mic test
  const [micLevel, setMicLevel] = useState(0);
  const micTestRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);

  // Load audio devices
  useEffect(() => {
    async function loadDevices() {
      try {
        // Need to request permission first to get device labels
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        setInputDevices(devices.filter(d => d.kind === 'audioinput'));
        setOutputDevices(devices.filter(d => d.kind === 'audiooutput'));
      } catch (err) {
        console.error('Could not enumerate devices:', err);
      }
    }
    loadDevices();
  }, []);

  // Mic test visualization
  useEffect(() => {
    if (activeTab !== 'voice') {
      stopMicTest();
      return;
    }
    startMicTest();
    return () => stopMicTest();
  }, [activeTab, inputDevice]);

  async function startMicTest() {
    stopMicTest();
    try {
      const constraints = { audio: inputDevice ? { deviceId: { exact: inputDevice } } : true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      micTestRef.current = stream;
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = { ctx, analyser };

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      function tick() {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setMicLevel(Math.min(100, (avg / 128) * 100 * (inputVolume / 100)));
        animFrameRef.current = requestAnimationFrame(tick);
      }
      tick();
    } catch (err) {
      console.error('Mic test error:', err);
    }
  }

  function stopMicTest() {
    if (micTestRef.current) {
      micTestRef.current.getTracks().forEach(t => t.stop());
      micTestRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.ctx.close();
      analyserRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setMicLevel(0);
  }

  // Save account changes
  const saveAccount = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch(`${API}/profile`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      if (res.ok) {
        setSaveMsg('Saved!');
        setTimeout(() => setSaveMsg(''), 2000);
      } else {
        const data = await res.json();
        setSaveMsg(data.error || 'Failed to save');
      }
    } catch {
      setSaveMsg('Failed to save');
    }
    setSaving(false);
  };

  // Save voice settings
  const saveVoiceSettings = () => {
    const newSettings = { inputDevice, outputDevice, inputVolume, outputVolume, pttEnabled, pttKey };
    onVoiceSettingsChange(newSettings);
    localStorage.setItem('dicksword-voice-settings', JSON.stringify(newSettings));
    setSaveMsg('Saved!');
    setTimeout(() => setSaveMsg(''), 2000);
  };

  // PTT key listener
  useEffect(() => {
    if (!listeningForKey) return;
    const handler = (e) => {
      e.preventDefault();
      setPttKey(e.code);
      setListeningForKey(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [listeningForKey]);

  const formatKeyName = (code) => {
    if (!code) return 'None';
    return code.replace('Key', '').replace('Digit', '').replace('Left', 'L-').replace('Right', 'R-');
  };

  const tabs = [
    { id: 'account', label: 'My Account' },
    { id: 'voice', label: 'Voice & Audio' },
  ];

  return (
    <div className="settings-overlay">
      <div className="settings-container">
        {/* Settings sidebar */}
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">Settings</div>
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </div>
          ))}
          <div className="settings-tab" style={{ color: 'var(--red)', marginTop: 16 }} onClick={onClose}>
            Close Settings
          </div>
        </div>

        {/* Settings content */}
        <div className="settings-content">
          <button className="settings-close-btn" onClick={onClose}>✕ ESC</button>

          {activeTab === 'account' && (
            <div className="settings-section">
              <h2>My Account</h2>

              <div className="settings-card">
                <div className="settings-card-header" style={{ background: user.avatar_color }}>
                  <div className="settings-avatar" style={{ background: user.avatar_color, border: '4px solid var(--bg-primary)' }}>
                    {user.username?.charAt(0).toUpperCase()}
                  </div>
                </div>
                <div className="settings-card-body">
                  <div className="settings-field">
                    <label>Username</label>
                    <input
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      placeholder="Your username"
                    />
                  </div>
                  <div className="settings-field">
                    <label>Email</label>
                    <input value={user.email || ''} disabled style={{ opacity: 0.5 }} />
                  </div>
                  <div className="settings-actions">
                    {saveMsg && <span style={{ color: saveMsg === 'Saved!' ? 'var(--green)' : 'var(--red)', fontSize: 14 }}>{saveMsg}</span>}
                    <button className="btn-submit" onClick={saveAccount} disabled={saving || username === user.username}>
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'voice' && (
            <div className="settings-section">
              <h2>Voice & Audio</h2>

              {/* Input device */}
              <div className="settings-field">
                <label>Input Device (Microphone)</label>
                <select
                  value={inputDevice}
                  onChange={e => setInputDevice(e.target.value)}
                  className="settings-select"
                >
                  <option value="">Default</option>
                  {inputDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 8)}`}</option>
                  ))}
                </select>
              </div>

              {/* Input volume */}
              <div className="settings-field">
                <label>Input Volume — {inputVolume}%</label>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={inputVolume}
                  onChange={e => setInputVolume(Number(e.target.value))}
                  className="settings-slider"
                />
              </div>

              {/* Mic test */}
              <div className="settings-field">
                <label>Mic Test</label>
                <div className="mic-level-bar">
                  <div className="mic-level-fill" style={{ width: `${micLevel}%` }} />
                </div>
              </div>

              <div className="settings-divider" />

              {/* Output device */}
              <div className="settings-field">
                <label>Output Device (Speakers/Headphones)</label>
                <select
                  value={outputDevice}
                  onChange={e => setOutputDevice(e.target.value)}
                  className="settings-select"
                >
                  <option value="">Default</option>
                  {outputDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Output ${d.deviceId.slice(0, 8)}`}</option>
                  ))}
                </select>
              </div>

              {/* Output volume */}
              <div className="settings-field">
                <label>Output Volume — {outputVolume}%</label>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={outputVolume}
                  onChange={e => setOutputVolume(Number(e.target.value))}
                  className="settings-slider"
                />
              </div>

              <div className="settings-divider" />

              {/* Push to talk */}
              <div className="settings-field">
                <label>Input Mode</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button
                    className="btn-submit"
                    style={{ background: !pttEnabled ? 'var(--brand-color)' : 'var(--bg-tertiary)', flex: 1 }}
                    onClick={() => setPttEnabled(false)}
                  >Voice Activity</button>
                  <button
                    className="btn-submit"
                    style={{ background: pttEnabled ? 'var(--brand-color)' : 'var(--bg-tertiary)', flex: 1 }}
                    onClick={() => setPttEnabled(true)}
                  >Push to Talk</button>
                </div>
              </div>

              {pttEnabled && (
                <div className="settings-field">
                  <label>Push to Talk Key</label>
                  <button
                    className="ptt-key-btn"
                    onClick={() => setListeningForKey(true)}
                  >
                    {listeningForKey ? 'Press any key...' : formatKeyName(pttKey)}
                  </button>
                  <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                    Hold this key to transmit your voice
                  </p>
                </div>
              )}

              <div className="settings-actions" style={{ marginTop: 24 }}>
                {saveMsg && <span style={{ color: 'var(--green)', fontSize: 14 }}>{saveMsg}</span>}
                <button className="btn-submit" onClick={saveVoiceSettings}>Save Voice Settings</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
