# Dicksword

A self-hosted voice chat app for you and your friends. No face scans required.

## Features

- User accounts (login/register)
- Create servers with invite codes
- Text channels with real-time messaging
- Voice channels with WebRTC (peer-to-peer audio)
- Screen sharing
- Mute/unmute
- Discord-like dark UI
- Works on desktop browsers and mobile
- Desktop app (Windows + Mac)

## Quick Start (Local)

```bash
npm install
cd client && npm install && npx vite build && cd ..
NODE_ENV=production node server/index.js
```

Then open `http://localhost:3001`.

## Development

```bash
npm run dev
```

- Client: http://localhost:5173
- Server API: http://localhost:3001

---

## Deploy to Railway (Recommended)

Railway gives you a free public URL with WebSocket support. No config needed.

### Steps:

1. Push this project to a GitHub repo
2. Go to [railway.com](https://railway.com) and sign in with GitHub
3. Click **"New Project"** > **"Deploy from GitHub Repo"**
4. Select your Dicksword repo
5. Railway auto-detects the config. Add these environment variables in the Railway dashboard:
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = (pick any random string, e.g. `my-super-secret-key-123`)
6. Railway will build and deploy. You'll get a URL like `https://dicksword-production-xxxx.up.railway.app`

That's it. Share the URL with your friends.

### Other hosting options:

- **Render** — similar to Railway, free tier available
- **Fly.io** — free tier, good for small apps
- **VPS** ($4-5/mo on Hetzner/DigitalOcean) — most control

---

## Desktop App (Electron)

The `electron/` folder has a ready-to-build desktop wrapper.

### Setup:

```bash
cd electron
npm install
```

### Configure your server URL:

Edit `electron/main.js` and change `SERVER_URL` to your Railway URL:

```js
const SERVER_URL = 'https://your-app.up.railway.app';
```

### Run locally:

```bash
npm start
```

### Build installers:

```bash
# Windows (.exe installer)
npm run build:win

# Mac (.dmg)
npm run build:mac

# Both
npm run build:all
```

The installers will be in `electron/dist/`. Send the `.exe` to Windows friends and `.dmg` to Mac friends.

**Note:** Building Mac apps on Windows (or vice versa) requires extra setup. Easiest to build on the target OS, or use GitHub Actions for cross-platform builds.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port (Railway sets this automatically) |
| `JWT_SECRET` | `dicksword-secret-...` | **Change this in production!** |
| `DATA_DIR` | project root | Where to store the SQLite database |
| `NODE_ENV` | - | Set to `production` to serve built client |
| `ALLOWED_ORIGINS` | - | Comma-separated origins for CORS (production) |

## Tech Stack

- **Backend**: Node.js, Express, Socket.IO, SQLite (better-sqlite3), JWT auth
- **Frontend**: React, Vite, Socket.IO client
- **Voice**: WebRTC (peer-to-peer, uses Google STUN servers)
- **Desktop**: Electron + electron-builder
