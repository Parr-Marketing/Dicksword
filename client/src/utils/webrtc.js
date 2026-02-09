// WebRTC voice chat manager
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ]
};

export class VoiceManager {
  constructor(socket) {
    this.socket = socket;
    this.peers = new Map(); // socketId -> RTCPeerConnection
    this.localStream = null;
    this.screenStream = null;
    this.channelId = null;
    this.onRemoteStream = null; // callback(socketId, stream)
    this.onRemoteStreamRemoved = null;
    this.onScreenStream = null;
    this.onScreenStreamRemoved = null;
    this.isMuted = false;

    this._setupSocketListeners();
  }

  _setupSocketListeners() {
    this.socket.on('voice-existing-peers', (peers) => {
      // Create offers to all existing peers
      peers.forEach(peer => this._createPeer(peer.socketId, true));
    });

    this.socket.on('voice-offer', async ({ from, offer }) => {
      const peer = this._createPeer(from, false);
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      this.socket.emit('voice-answer', { to: from, answer });
    });

    this.socket.on('voice-answer', async ({ from, answer }) => {
      const peer = this.peers.get(from);
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    this.socket.on('voice-ice-candidate', ({ from, candidate }) => {
      const peer = this.peers.get(from);
      if (peer && candidate) {
        peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
      }
    });

    this.socket.on('voice-user-left', ({ userId }) => {
      // Find and remove peer by checking all peers
      for (const [socketId, peer] of this.peers.entries()) {
        // We can't easily map userId to socketId here, so we rely on
        // the peer connection closing naturally. The server will handle cleanup.
      }
    });
  }

  _createPeer(socketId, isInitiator) {
    if (this.peers.has(socketId)) {
      this.peers.get(socketId).close();
    }

    const peer = new RTCPeerConnection(ICE_SERVERS);
    this.peers.set(socketId, peer);

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        peer.addTrack(track, this.localStream);
      });
    }

    // Handle ICE candidates
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('voice-ice-candidate', { to: socketId, candidate: event.candidate });
      }
    };

    // Handle remote tracks
    peer.ontrack = (event) => {
      if (this.onRemoteStream) {
        this.onRemoteStream(socketId, event.streams[0]);
      }
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
        this._removePeer(socketId);
      }
    };

    // If initiator, create offer
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
      if (this.onRemoteStreamRemoved) {
        this.onRemoteStreamRemoved(socketId);
      }
    }
  }

  async joinVoice(channelId) {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.channelId = channelId;
      this.socket.emit('voice-join', { channelId });
      return true;
    } catch (err) {
      console.error('Failed to get microphone:', err);
      return false;
    }
  }

  leaveVoice() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
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
        audio: true
      });

      // Add screen tracks to all peers
      const videoTrack = this.screenStream.getVideoTracks()[0];
      for (const [socketId, peer] of this.peers) {
        peer.addTrack(videoTrack, this.screenStream);
        // Renegotiate
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        this.socket.emit('voice-offer', { to: socketId, offer: peer.localDescription });
      }

      this.socket.emit('screen-share-start', { channelId: this.channelId });

      // Handle user stopping share via browser UI
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
  }
}
