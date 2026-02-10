import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { compressAvatar, compressBanner } from '../utils/imageCompression';

const API = '/api';
const MAX_LISTENBACK_SECS = 10;
const GITHUB_RELEASES = 'https://github.com/Parr-Marketing/Dicksword/releases/latest';
const DOWNLOAD_WIN = `${GITHUB_RELEASES}/download/Dicksword-Setup-1.0.0.exe`;
const DOWNLOAD_MAC = `${GITHUB_RELEASES}/download/Dicksword-1.0.0.dmg`;

export default function Settings({ onClose, voiceSettings, onVoiceSettingsChange }) {
  const { user, token } = useAuth();
  const [activeTab, setActiveTab] = useState('account');

  // Account state
  const [username, setUsername] = useState(user?.username || '');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Profile image state
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || null);
  const [bannerUrl, setBannerUrl] = useState(user?.banner_url || null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [bannerPreview, setBannerPreview] = useState(null);
  const [profileSaveMsg, setProfileSaveMsg] = useState('');
  const avatarInputRef = useRef(null);
  const bannerInputRef = useRef(null);

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
  const [muteKey, setMuteKey] = useState(voiceSettings.muteKey || '');
  const [noiseSuppression, setNoiseSuppression] = useState(voiceSettings.noiseSuppression !== false);
  const [echoCancellation, setEchoCancellation] = useState(voiceSettings.echoCancellation !== false);
  const [autoGainControl, setAutoGainControl] = useState(voiceSettings.autoGainControl !== false);
  const [listeningForKey, setListeningForKey] = useState(null); // 'ptt' | 'mute' | null

  // Mic test
  const [micLevel, setMicLevel] = useState(0);
  const micTestRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);

  // Listenback state
  const [lbRecording, setLbRecording] = useState(false);
  const [lbAudioUrl, setLbAudioUrl] = useState(null);
  const [lbPlaying, setLbPlaying] = useState(false);
  const [lbProgress, setLbProgress] = useState(0);
  const [lbDuration, setLbDuration] = useState(0);
  const lbRecorderRef = useRef(null);
  const lbStreamRef = useRef(null);
  const lbAudioRef = useRef(null);
  const lbTimerRef = useRef(null);
  const lbStartTimeRef = useRef(null);
  const lbProgressRef = useRef(null);

  // Load audio devices
  useEffect(() => {
    async function loadDevices() {
      try {
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

  // Cleanup listenback on unmount or tab change
  useEffect(() => {
    return () => cleanupListenback();
  }, []);

  useEffect(() => {
    if (activeTab !== 'voice') {
      cleanupListenback();
    }
  }, [activeTab]);

  function cleanupListenback() {
    // Stop recording if active
    if (lbRecorderRef.current && lbRecorderRef.current.state !== 'inactive') {
      lbRecorderRef.current.stop();
    }
    if (lbStreamRef.current) {
      lbStreamRef.current.getTracks().forEach(t => t.stop());
      lbStreamRef.current = null;
    }
    if (lbTimerRef.current) {
      clearTimeout(lbTimerRef.current);
      lbTimerRef.current = null;
    }
    if (lbProgressRef.current) {
      clearInterval(lbProgressRef.current);
      lbProgressRef.current = null;
    }
    // Revoke any existing blob URL
    if (lbAudioUrl) {
      URL.revokeObjectURL(lbAudioUrl);
    }
    if (lbAudioRef.current) {
      lbAudioRef.current.pause();
      lbAudioRef.current = null;
    }
    setLbAudioUrl(null);
    setLbRecording(false);
    setLbPlaying(false);
    setLbProgress(0);
    setLbDuration(0);
  }

  async function startListenback() {
    // Clean up any previous recording
    cleanupListenback();

    try {
      const constraints = { audio: inputDevice ? { deviceId: { exact: inputDevice } } : true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      lbStreamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      lbRecorderRef.current = recorder;
      const chunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        // Stop mic stream
        stream.getTracks().forEach(t => t.stop());
        lbStreamRef.current = null;

        const blob = new Blob(chunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setLbAudioUrl(url);
        setLbRecording(false);
        setLbProgress(0);

        // Get duration
        const tempAudio = new Audio(url);
        tempAudio.onloadedmetadata = () => {
          if (isFinite(tempAudio.duration)) {
            setLbDuration(tempAudio.duration);
          }
        };
      };

      recorder.start();
      setLbRecording(true);
      lbStartTimeRef.current = Date.now();

      // Progress ticker
      lbProgressRef.current = setInterval(() => {
        const elapsed = (Date.now() - lbStartTimeRef.current) / 1000;
        setLbProgress(Math.min(elapsed, MAX_LISTENBACK_SECS));
      }, 100);

      // Auto-stop after 10 seconds
      lbTimerRef.current = setTimeout(() => {
        if (lbProgressRef.current) {
          clearInterval(lbProgressRef.current);
          lbProgressRef.current = null;
        }
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      }, MAX_LISTENBACK_SECS * 1000);

    } catch (err) {
      console.error('Listenback record error:', err);
      setLbRecording(false);
    }
  }

  function stopListenbackRecording() {
    if (lbTimerRef.current) {
      clearTimeout(lbTimerRef.current);
      lbTimerRef.current = null;
    }
    if (lbProgressRef.current) {
      clearInterval(lbProgressRef.current);
      lbProgressRef.current = null;
    }
    if (lbRecorderRef.current && lbRecorderRef.current.state !== 'inactive') {
      lbRecorderRef.current.stop();
    }
  }

  function playListenback() {
    if (!lbAudioUrl) return;
    if (lbAudioRef.current) {
      lbAudioRef.current.pause();
    }
    const audio = new Audio(lbAudioUrl);
    lbAudioRef.current = audio;

    // Apply output device if set
    if (outputDevice && audio.setSinkId) {
      audio.setSinkId(outputDevice).catch(() => {});
    }
    audio.volume = Math.min(1, outputVolume / 100);

    audio.onplay = () => setLbPlaying(true);
    audio.onended = () => { setLbPlaying(false); setLbProgress(0); };
    audio.ontimeupdate = () => setLbProgress(audio.currentTime);

    audio.play().catch(console.error);
  }

  function stopListenbackPlayback() {
    if (lbAudioRef.current) {
      lbAudioRef.current.pause();
      lbAudioRef.current.currentTime = 0;
      setLbPlaying(false);
      setLbProgress(0);
    }
  }

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
    const newSettings = { inputDevice, outputDevice, inputVolume, outputVolume, pttEnabled, pttKey, muteKey, noiseSuppression, echoCancellation, autoGainControl };
    onVoiceSettingsChange(newSettings);
    localStorage.setItem('dicksword-voice-settings', JSON.stringify(newSettings));
    setSaveMsg('Saved!');
    setTimeout(() => setSaveMsg(''), 2000);
  };

  // Profile image handlers
  const handleAvatarSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressAvatar(file);
      setAvatarPreview(dataUrl);
    } catch (err) {
      setProfileSaveMsg(err.message);
      setTimeout(() => setProfileSaveMsg(''), 3000);
    }
  };

  const handleBannerSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressBanner(file);
      setBannerPreview(dataUrl);
    } catch (err) {
      setProfileSaveMsg(err.message);
      setTimeout(() => setProfileSaveMsg(''), 3000);
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    setProfileSaveMsg('');
    try {
      const body = {};
      if (avatarPreview !== null) body.avatar_url = avatarPreview;
      if (bannerPreview !== null) body.banner_url = bannerPreview;
      if (Object.keys(body).length === 0) {
        setSaving(false);
        return;
      }
      const res = await fetch(`${API}/profile`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const data = await res.json();
        setAvatarUrl(data.avatar_url);
        setBannerUrl(data.banner_url);
        setAvatarPreview(null);
        setBannerPreview(null);
        setProfileSaveMsg('Saved!');
      } else {
        const data = await res.json();
        setProfileSaveMsg(data.error || 'Failed');
      }
    } catch {
      setProfileSaveMsg('Failed to save');
    }
    setSaving(false);
    setTimeout(() => setProfileSaveMsg(''), 3000);
  };

  const removeAvatar = async () => {
    const res = await fetch(`${API}/profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar_url: '' })
    });
    if (res.ok) {
      setAvatarUrl(null);
      setAvatarPreview(null);
      setProfileSaveMsg('Avatar removed');
      setTimeout(() => setProfileSaveMsg(''), 2000);
    }
  };

  const removeBanner = async () => {
    const res = await fetch(`${API}/profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ banner_url: '' })
    });
    if (res.ok) {
      setBannerUrl(null);
      setBannerPreview(null);
      setProfileSaveMsg('Banner removed');
      setTimeout(() => setProfileSaveMsg(''), 2000);
    }
  };

  // Key listener for PTT or mute key binding
  useEffect(() => {
    if (!listeningForKey) return;
    const handler = (e) => {
      e.preventDefault();
      if (listeningForKey === 'ptt') {
        setPttKey(e.code);
      } else if (listeningForKey === 'mute') {
        setMuteKey(e.code);
      }
      setListeningForKey(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [listeningForKey]);

  const formatKeyName = (code) => {
    if (!code) return 'None';
    return code.replace('Key', '').replace('Digit', '').replace('Left', 'L-').replace('Right', 'R-');
  };

  // Close handler that cleans up listenback
  const handleClose = () => {
    cleanupListenback();
    onClose();
  };

  const tabs = [
    { id: 'account', label: 'My Account' },
    { id: 'profile', label: 'Profile' },
    { id: 'voice', label: 'Voice & Audio' },
    { id: 'app', label: 'Get the App' },
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
          <div className="settings-tab" style={{ color: 'var(--red)', marginTop: 16 }} onClick={handleClose}>
            Close Settings
          </div>
        </div>

        {/* Settings content */}
        <div className="settings-content">
          <button className="settings-close-btn" onClick={handleClose}>✕ ESC</button>

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

          {activeTab === 'profile' && (
            <div className="settings-section">
              <h2>Profile</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 }}>
                Customize how others see you. Avatar and banner are visible on your profile card.
              </p>

              {/* Banner upload */}
              <div className="settings-field">
                <label>Banner</label>
                <div
                  className="profile-upload-zone banner-zone"
                  onClick={() => bannerInputRef.current?.click()}
                  style={
                    (bannerPreview || bannerUrl)
                      ? { backgroundImage: `url(${bannerPreview || bannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                      : { background: `linear-gradient(135deg, ${user.avatar_color || '#5865F2'}, #2b2d31)` }
                  }
                >
                  {!bannerPreview && !bannerUrl && <span className="upload-hint">Click to upload banner (600×240, max 300KB)</span>}
                </div>
                <input ref={bannerInputRef} type="file" accept="image/*" onChange={handleBannerSelect} style={{ display: 'none' }} />
                {(bannerPreview || bannerUrl) && (
                  <button className="btn-submit" style={{ background: 'var(--red)', marginTop: 8, fontSize: 12, padding: '4px 12px' }} onClick={removeBanner}>Remove Banner</button>
                )}
              </div>

              {/* Avatar upload */}
              <div className="settings-field">
                <label>Avatar</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div
                    className="profile-upload-avatar"
                    onClick={() => avatarInputRef.current?.click()}
                    style={{ background: user.avatar_color || '#5865F2' }}
                  >
                    {(avatarPreview || avatarUrl)
                      ? <img src={avatarPreview || avatarUrl} className="avatar-img" alt="Avatar" />
                      : <span>{user.username?.charAt(0).toUpperCase()}</span>
                    }
                    <div className="upload-avatar-overlay">Edit</div>
                  </div>
                  <div>
                    <p style={{ color: 'var(--text-normal)', fontSize: 14 }}>Click avatar to change</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>128×128, max 100KB</p>
                  </div>
                </div>
                <input ref={avatarInputRef} type="file" accept="image/*" onChange={handleAvatarSelect} style={{ display: 'none' }} />
                {(avatarPreview || avatarUrl) && (
                  <button className="btn-submit" style={{ background: 'var(--red)', marginTop: 8, fontSize: 12, padding: '4px 12px' }} onClick={removeAvatar}>Remove Avatar</button>
                )}
              </div>

              <div className="settings-actions">
                {profileSaveMsg && <span style={{ color: profileSaveMsg === 'Saved!' ? 'var(--green)' : 'var(--red)', fontSize: 14 }}>{profileSaveMsg}</span>}
                <button
                  className="btn-submit"
                  onClick={saveProfile}
                  disabled={saving || (!avatarPreview && !bannerPreview)}
                >
                  {saving ? 'Saving...' : 'Save Profile'}
                </button>
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

              {/* Listenback */}
              <div className="settings-field">
                <label>Listenback (up to {MAX_LISTENBACK_SECS}s)</label>
                <div className="listenback-controls">
                  {!lbRecording && !lbAudioUrl && (
                    <button className="btn-submit" style={{ background: 'var(--red)' }} onClick={startListenback}>
                      Record
                    </button>
                  )}
                  {lbRecording && (
                    <>
                      <div className="listenback-progress-bar">
                        <div className="listenback-progress-fill recording" style={{ width: `${(lbProgress / MAX_LISTENBACK_SECS) * 100}%` }} />
                      </div>
                      <span className="listenback-time">{lbProgress.toFixed(1)}s / {MAX_LISTENBACK_SECS}s</span>
                      <button className="btn-submit" style={{ background: 'var(--bg-tertiary)', marginLeft: 8 }} onClick={stopListenbackRecording}>
                        Stop
                      </button>
                    </>
                  )}
                  {!lbRecording && lbAudioUrl && (
                    <>
                      <div className="listenback-progress-bar">
                        <div className="listenback-progress-fill" style={{ width: lbDuration ? `${(lbProgress / lbDuration) * 100}%` : '0%' }} />
                      </div>
                      <div className="listenback-btns">
                        {!lbPlaying ? (
                          <button className="btn-submit" style={{ background: 'var(--green)' }} onClick={playListenback}>
                            Play
                          </button>
                        ) : (
                          <button className="btn-submit" style={{ background: 'var(--bg-tertiary)' }} onClick={stopListenbackPlayback}>
                            Stop
                          </button>
                        )}
                        <button className="btn-submit" style={{ background: 'var(--red)' }} onClick={startListenback}>
                          Re-record
                        </button>
                        <button className="btn-submit" style={{ background: 'var(--bg-tertiary)' }} onClick={cleanupListenback}>
                          Delete
                        </button>
                      </div>
                    </>
                  )}
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
                    onClick={() => setListeningForKey('ptt')}
                  >
                    {listeningForKey === 'ptt' ? 'Press any key...' : formatKeyName(pttKey)}
                  </button>
                  <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                    Hold this key to transmit your voice
                  </p>
                </div>
              )}

              <div className="settings-divider" />

              {/* Mute toggle key */}
              <div className="settings-field">
                <label>Mute Toggle Key</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    className="ptt-key-btn"
                    onClick={() => setListeningForKey('mute')}
                  >
                    {listeningForKey === 'mute' ? 'Press any key...' : (muteKey ? formatKeyName(muteKey) : 'Not set')}
                  </button>
                  {muteKey && (
                    <button
                      className="btn-submit"
                      style={{ background: 'var(--bg-tertiary)', padding: '8px 12px', fontSize: 13 }}
                      onClick={() => setMuteKey('')}
                    >Clear</button>
                  )}
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                  Press this key to toggle mute/unmute
                </p>
              </div>

              <div className="settings-divider" />

              {/* Audio Processing */}
              <div className="settings-field">
                <label>Audio Processing</label>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
                  These reduce background noise and improve voice quality. Changes apply next time you join voice.
                </p>
                <div className="settings-toggle-group">
                  <div className="settings-toggle-row" onClick={() => setNoiseSuppression(!noiseSuppression)}>
                    <span>Noise Suppression</span>
                    <div className={`settings-toggle ${noiseSuppression ? 'on' : ''}`}>
                      <div className="settings-toggle-knob" />
                    </div>
                  </div>
                  <div className="settings-toggle-row" onClick={() => setEchoCancellation(!echoCancellation)}>
                    <span>Echo Cancellation</span>
                    <div className={`settings-toggle ${echoCancellation ? 'on' : ''}`}>
                      <div className="settings-toggle-knob" />
                    </div>
                  </div>
                  <div className="settings-toggle-row" onClick={() => setAutoGainControl(!autoGainControl)}>
                    <span>Auto Gain Control</span>
                    <div className={`settings-toggle ${autoGainControl ? 'on' : ''}`}>
                      <div className="settings-toggle-knob" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="settings-actions" style={{ marginTop: 24 }}>
                {saveMsg && <span style={{ color: 'var(--green)', fontSize: 14 }}>{saveMsg}</span>}
                <button className="btn-submit" onClick={saveVoiceSettings}>Save Voice Settings</button>
              </div>
            </div>
          )}

          {activeTab === 'app' && (
            <div className="settings-section">
              <h2>Get the Desktop App</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>
                Download Dicksword for your computer for the best experience — native notifications, global keybinds, and a dedicated window.
              </p>
              <div className="download-buttons" style={{ justifyContent: 'flex-start' }}>
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
          )}
        </div>
      </div>
    </div>
  );
}
