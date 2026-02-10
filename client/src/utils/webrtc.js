// WebRTC voice chat manager
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Free TURN servers for NAT traversal
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
  ]
};

export class VoiceManager {
  constructor(socket) {
    this.socket = socket;
    this.peers = new Map();
    this.localStream = null;
    this.processedStream = null;
    this.screenStream = null;
    this.channelId = null;
    this.onRemoteStream = null;
    this.onRemoteStreamRemoved = null;
    this.onScreenShareReceived = null;
    this.onScreenShareStopped = null;
    this.onSpeakingChange = null; // callback: (socketId, isSpeaking) => {}
    this.isMuted = false;

    // Audio processing
    this.audioContext = null;
    this.gainNode = null;
    this.sourceNode = null;

    // Voice activity detection
    this._vadIntervals = new Map(); // socketId -> intervalId
    this._localVadInterval = null;

    this._setupSocketListeners();
  }

  _setupSocketListeners() {
    this.socket.on('voice-existing-peers', (peers) => {
      peers.forEach(peer => this._createPeer(peer.socketId, true));
    });

    this.socket.on('voice-offer', async ({ from, offer }) => {
      let peer = this.peers.get(from);
      if (peer) {
        // Renegotiation on existing peer (e.g. screen share added/removed)
        try {
          await peer.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          this.socket.emit('voice-answer', { to: from, answer });
        } catch (err) {
          console.error('Renegotiation error:', err);
          // Recreate the peer on failure
          this._removePeer(from);
          peer = this._createPeer(from, false);
          await peer.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          this.socket.emit('voice-answer', { to: from, answer });
        }
      } else {
        // New peer
        peer = this._createPeer(from, false);
        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        this.socket.emit('voice-answer', { to: from, answer });
      }
    });

    this.socket.on('voice-answer', async ({ from, answer }) => {
      const peer = this.peers.get(from);
      if (peer && peer.signalingState === 'have-local-offer') {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    this.socket.on('voice-ice-candidate', ({ from, candidate }) => {
      const peer = this.peers.get(from);
      if (peer && candidate) {
        peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      }
    });

    // Clean up peer when a user leaves voice
    this.socket.on('voice-user-left', ({ socketId }) => {
      if (socketId) {
        this._removePeer(socketId);
      }
    });

    // When a remote user stops screen sharing
    this.socket.on('screen-share-stopped', ({ userId }) => {
      if (this.onScreenShareStopped) {
        this.onScreenShareStopped(userId);
      }
    });
  }

  _startVAD(socketId, stream) {
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      let wasSpeaking = false;

      const interval = setInterval(() => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const isSpeaking = avg > 15;

        if (isSpeaking !== wasSpeaking) {
          wasSpeaking = isSpeaking;
          if (this.onSpeakingChange) {
            this.onSpeakingChange(socketId, isSpeaking);
          }
        }
      }, 100);

      this._vadIntervals.set(socketId, { interval, ctx });
    } catch (err) {
      console.warn('VAD setup failed for', socketId, err);
    }
  }

  _stopVAD(socketId) {
    const vad = this._vadIntervals.get(socketId);
    if (vad) {
      clearInterval(vad.interval);
      vad.ctx.close().catch(() => {});
      this._vadIntervals.delete(socketId);
    }
  }

  _createPeer(socketId, isInitiator) {
    if (this.peers.has(socketId)) {
      this.peers.get(socketId).close();
      this._stopVAD(socketId);
    }

    const peer = new RTCPeerConnection(ICE_SERVERS);
    this.peers.set(socketId, peer);

    const streamToSend = this.processedStream || this.localStream;
    if (streamToSend) {
      streamToSend.getTracks().forEach(track => {
        peer.addTrack(track, streamToSend);
      });
    }

    // If we're currently screen sharing, also add the video track
    if (this.screenStream) {
      const videoTrack = this.screenStream.getVideoTracks()[0];
      if (videoTrack) {
        peer.addTrack(videoTrack, this.screenStream);
      }
    }

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('voice-ice-candidate', { to: socketId, candidate: event.candidate });
      }
    };

    peer.ontrack = (event) => {
      const track = event.track;
      if (track.kind === 'video') {
        // Video track = screen share
        if (this.onScreenShareReceived) {
          this.onScreenShareReceived(socketId, event.streams[0]);
        }
      } else if (track.kind === 'audio') {
        if (this.onRemoteStream) {
          this.onRemoteStream(socketId, event.streams[0]);
        }
        // Start voice activity detection on this remote stream
        this._startVAD(socketId, event.streams[0]);
      }
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
        this._removePeer(socketId);
      }
    };

    peer.oniceconnectionstatechange = () => {
      if (peer.iceConnectionState === 'failed') {
        // Try ICE restart
        peer.restartIce();
      }
    };

    if (isInitiator) {
      peer.createOffer()
        .then(offer => peer.setLocalDescription(offer))
        .then(() => {
          this.socket.emit('voice-offer', { to: socketId, offer: peer.localDescription });
        })
        .catch(console.error);
    }

    return peer;
  }

  _removePeer(socketId) {
    const peer = this.peers.get(socketId);
    if (peer) {
      peer.close();
      this.peers.delete(socketId);
      this._stopVAD(socketId);
      if (this.onRemoteStreamRemoved) {
        this.onRemoteStreamRemoved(socketId);
      }
      if (this.onSpeakingChange) {
        this.onSpeakingChange(socketId, false);
      }
    }
  }

  async joinVoice(channelId, options = {}) {
    try {
      const constraints = {
        audio: {
          ...(options.inputDevice ? { deviceId: { exact: options.inputDevice } } : {}),
          noiseSuppression: options.noiseSuppression !== false,
          echoCancellation: options.echoCancellation !== false,
          autoGainControl: options.autoGainControl !== false,
        },
        video: false
      };

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Set up gain node for input volume control
      try {
        this.audioContext = new AudioContext();
        this.sourceNode = this.audioContext.createMediaStreamSource(this.localStream);
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = (options.inputVolume || 100) / 100;

        const destination = this.audioContext.createMediaStreamDestination();
        this.sourceNode.connect(this.gainNode);
        this.gainNode.connect(destination);
        this.processedStream = destination.stream;
      } catch (err) {
        console.warn('Could not set up gain node, using raw stream:', err);
        this.processedStream = this.localStream;
      }

      // Start local VAD (use 'local' as the socketId key)
      this._startVAD('local', this.processedStream || this.localStream);

      this.channelId = channelId;
      this.socket.emit('voice-join', { channelId });
      return true;
    } catch (err) {
      console.error('Failed to get microphone:', err);
      return false;
    }
  }

  leaveVoice() {
    // Stop all VAD
    this._stopVAD('local');
    for (const socketId of this._vadIntervals.keys()) {
      this._stopVAD(socketId);
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.processedStream) {
      this.processedStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
      this.gainNode = null;
      this.sourceNode = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }
    for (const [, peer] of this.peers) {
      peer.close();
    }
    this.peers.clear();
    if (this.channelId) {
      this.socket.emit('voice-leave', { channelId: this.channelId });
    }
    this.channelId = null;
  }

  toggleMute() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        this.isMuted = !audioTrack.enabled;
        return this.isMuted;
      }
    }
    return false;
  }

  async startScreenShare() {
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false
      });

      const videoTrack = this.screenStream.getVideoTracks()[0];

      // Add the video track to all existing peers and renegotiate
      for (const [socketId, peer] of this.peers) {
        peer.addTrack(videoTrack, this.screenStream);
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        this.socket.emit('voice-offer', { to: socketId, offer: peer.localDescription });
      }

      this.socket.emit('screen-share-start', { channelId: this.channelId });

      // Auto-stop when user clicks browser's "Stop sharing" button
      videoTrack.onended = () => {
        this.stopScreenShare();
      };

      return this.screenStream;
    } catch (err) {
      console.error('Screen share failed:', err);
      return null;
    }
  }

  stopScreenShare() {
    if (this.screenStream) {
      const videoTrack = this.screenStream.getVideoTracks()[0];

      // Remove the video track from all peers and renegotiate
      for (const [socketId, peer] of this.peers) {
        const senders = peer.getSenders();
        const videoSender = senders.find(s => s.track === videoTrack);
        if (videoSender) {
          peer.removeTrack(videoSender);
          peer.createOffer()
            .then(offer => peer.setLocalDescription(offer))
            .then(() => {
              this.socket.emit('voice-offer', { to: socketId, offer: peer.localDescription });
            })
            .catch(console.error);
        }
      }

      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
      this.socket.emit('screen-share-stop', { channelId: this.channelId });
    }
  }

  destroy() {
    this.leaveVoice();
    this.socket.off('voice-existing-peers');
    this.socket.off('voice-offer');
    this.socket.off('voice-answer');
    this.socket.off('voice-ice-candidate');
    this.socket.off('voice-user-left');
    this.socket.off('screen-share-stopped');
  }
}
