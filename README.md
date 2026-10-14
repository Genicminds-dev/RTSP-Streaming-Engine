# Dynamic Multi-Camera RTSP Streaming Hub & Smart Neckband Portal Integration

A high-performance, low-latency, dynamic multi-camera RTSP streaming engine and web dashboard built with **Node.js (Express)**, **FFmpeg**, **HLS (HTTP Live Streaming)**, and **React + Hls.js**.

Designed to convert multiple RTSP IP camera feeds into browser-compatible HLS streams, generate public HTTPS stream URLs, and seamlessly integrate into your **Smart Neckband Portal**.

---

## 📁 Project Structure

```
rtsp-live-camera-project/
│
├── client/                                 # Frontend Web Dashboard (React + Vite + Hls.js)
│   ├── src/
│   │   ├── App.jsx                         # Multi-camera registry, live player & diagnostics
│   │   ├── main.jsx                        # React root entry
│   │   └── styles.css                      # Modern dark/light dashboard theme
│   ├── index.html                          # HTML entry point
│   ├── vite.config.js                      # Vite reverse proxy & vendor chunk splitting
│   ├── package.json                        # Client dependencies & build scripts
│   └── .gitignore
│
├── server/                                 # Backend Streaming Engine (Node.js + Express + FFmpeg)
│   ├── data/
│   │   └── cameras.json                    # Dynamic camera database (persisted JSON)
│   ├── public/
│   │   ├── streams/<cameraId>/             # Real-time HLS segments (.m3u8 & .ts)
│   │   └── embed.html                      # Standalone iframe player for portal embeds
│   ├── cameraManager.js                    # Multi-camera manager & FFmpeg process controller
│   ├── index.js                            # REST API, static stream server & CORS
│   ├── .env                                # Local environment configuration
│   ├── .env.example                        # Configuration template
│   ├── package.json                        # Server dependencies & scripts
│   └── .gitignore
│
├── integration/                            # Smart Neckband Portal Integration Files
│   ├── SmartNeckbandCameraViewer.jsx       # Drop-in React component for your portal
│   ├── smart-neckband-camera-widget.js     # Drop-in Vanilla JS modal widget (any website)
│   └── SMART_NECKBAND_INTEGRATION_GUIDE.md # Complete integration tutorial
│
├── HOSTINGER_DEPLOYMENT_GUIDE.md           # Step-by-step Hostinger VPS & SSL deployment guide
├── .gitignore                              # Root Git ignore rules
└── README.md                               # Project documentation
```

---

## 🌟 Key Features

- **Dynamic Multi-Camera Registration:** Add, edit, or delete IP cameras on-the-fly via the UI or REST API without modifying any code or restarting the server.
- **RTSP to Browser-Compatible HLS:** FFmpeg converts RTSP feeds into low-latency HLS playlists (`.m3u8`) and video chunks (`.ts`) compatible with Chrome, Safari, Edge, Firefox, and mobile devices.
- **Credential Protection & Security:** Sensitive camera credentials (`rtsp://user:pass@ip...`) remain strictly on the server and are never exposed to clients or public portals.
- **Smart Neckband Portal Ready:**
  - **Iframe Embed:** Single-line iframe player at `https://your-domain.com/embed/<cameraId>`.
  - **React Component:** Drop-in `SmartNeckbandCameraViewer.jsx` with dynamic camera switching dropdown.
  - **Vanilla JS Widget:** Zero-dependency modal popup widget via `widget.js`.
- **Ultra-Low Latency & Stream-Copy:**
  - Configured with `-fflags nobuffer -flags low_delay -analyzeduration 1000000 -probesize 1000000` for 1.5–2s initial connection.
  - Supports `VIDEO_CODEC=copy` for near **0% CPU** consumption on cameras that already output H.264.
- **Process Isolation & Windows/Linux Stability:** Each camera stream runs in an independent child process. Synchronous process tree termination guarantees zero locked-file errors on Windows and zero orphan background processes.

---

## 🏗️ Architecture & Data Flow

```mermaid
flowchart TD
    subgraph Cameras ["IP Cameras / NVRs"]
        C1["Camera 01 (Main Gate)\nRTSP: 554"]
        C2["Camera 02 (Warehouse)\nRTSP: 554"]
        C3["Camera N (Custom)\nRTSP: 554"]
    end

    subgraph Backend ["Streaming Server (Hostinger VPS / Local Port 4000)"]
        CM["CameraManager\n(server/cameraManager.js)"]
        DB["cameras.json\n(Persisted Data)"]
        F1["FFmpeg Process 1\n(Low-latency HLS)"]
        F2["FFmpeg Process 2\n(Low-latency HLS)"]
        API["Express REST API & Static Server\n(Zero-Cache + CORS Enabled)"]
    end

    subgraph Clients ["Web Consumers"]
        DASH["Camera Streaming Hub\n(Port 5173 / camera.domain.com)"]
        PORTAL["Smart Neckband Portal\n(Hostinger Web Hosting / External Site)"]
    end

    C1 -->|TCP| F1
    C2 -->|TCP| F2
    CM --> DB
    CM --> F1
    CM --> F2
    F1 -->|Generates segments| API
    F2 -->|Generates segments| API
    API -->|HTTPS /streams/cam-01/index.m3u8| DASH
    API -->|HTTPS /embed/:id or /api/cameras| PORTAL
```

---

## 🚀 Quick Start & Local Setup

### Step 1: Start the Backend Server

```powershell
cd server

# Configure environment (first run only)
Copy-Item .env.example .env

# Install backend dependencies
npm install

# Start the server (auto-reloads on code changes)
npm run dev
```

The server starts at **http://localhost:4000**.
It will automatically pre-seed `Camera 01` using the `RTSP_URL` in `server/.env`.

---

### Step 2: Start the Frontend Client

Open a second terminal window:

```powershell
cd client

# Install client dependencies
npm install

# Start Vite dev server
npm run dev
```

Open **http://localhost:5173** in your web browser.

---

## 🔌 REST API Endpoints

The backend provides a complete REST API for external applications:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health check & active stream statistics |
| `GET` | `/api/cameras` | List all registered cameras (credentials masked) |
| `POST` | `/api/cameras` | Register a new camera (`{ name, rtspUrl, codec }`) |
| `GET` | `/api/cameras/:id` | Get details of a single camera |
| `PUT` | `/api/cameras/:id` | Update camera name, RTSP URL, or codec |
| `DELETE` | `/api/cameras/:id` | Remove a camera and stop its stream |
| `GET` | `/api/cameras/:id/status` | Get real-time stream status for a camera |
| `POST` | `/api/cameras/:id/start` | Start live FFmpeg streaming for a camera |
| `POST` | `/api/cameras/:id/stop` | Stop live FFmpeg streaming for a camera |
| `GET` | `/embed/:cameraId` | Standalone responsive embed player for iframes |
| `GET` | `/widget.js` | Vanilla JS integration script for external portals |
| `GET` | `/streams/:cameraId/index.m3u8` | Live HLS playlist for player consumption |

---

## 🔗 Smart Neckband Portal Integration

See the dedicated [**Smart Neckband Portal Integration Guide**](./integration/SMART_NECKBAND_INTEGRATION_GUIDE.md) for full instructions and sample code.

### Quick Example: Iframe Embed
```html
<iframe
  src="https://camera.yourdomain.com/embed/cam-01"
  width="100%"
  height="480"
  frameborder="0"
  allow="autoplay; fullscreen"
  allowfullscreen>
</iframe>
```

### Quick Example: React Component
```jsx
import SmartNeckbandCameraViewer from "./integration/SmartNeckbandCameraViewer";

<SmartNeckbandCameraViewer serverUrl="https://camera.yourdomain.com" />
```

---

## ☁️ Hostinger Production Deployment

Live video streaming requires persistent background processes and system-level `ffmpeg`, which are **not supported on Hostinger Shared Web Hosting**.

Please read the complete [**Hostinger Deployment Guide**](./HOSTINGER_DEPLOYMENT_GUIDE.md) for:
1. Detailed comparison between Hostinger Shared Hosting vs. Hostinger VPS.
2. Step-by-step setup on an Ubuntu VPS.
3. Setting up **PM2** for persistent 24/7 background streaming.
4. Setting up **Nginx** reverse proxy with free **Let's Encrypt SSL (HTTPS)**.
5. Hybrid deployment (hosting your Smart Neckband Portal on shared hosting while running camera streams on VPS).

---

## ⚙️ Configuration Reference (`server/.env`)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `RTSP_URL` | *(required)* | Default RTSP URL (pre-seeded as `cam-01`) |
| `PORT` | `4000` | Port for Express server |
| `FFMPEG_PATH` | `ffmpeg` | Executable path to FFmpeg (`ffmpeg` or `C:/ffmpeg/bin/ffmpeg.exe`) |
| `VIDEO_CODEC` | `libx264` | `libx264` (transcoding) or `copy` (stream copy, near 0% CPU) |
| `HLS_SEGMENT_SECONDS` | `2` | Segment duration in seconds (1 to 2 recommended) |
| `HLS_LIST_SIZE` | `5` | Active playlist segment buffer size |
| `PUBLIC_URL` | `""` | Public HTTPS domain (e.g. `https://camera.yourdomain.com`) |
| `ADMIN_API_KEY` | `""` | Optional secret key to secure camera add/delete endpoints |

---

## 🛠️ Testing & Troubleshooting

### 1. Test RTSP URL in VLC First
Before adding any camera into the hub, test it in **VLC Media Player**:
- Open VLC -> `Media` -> `Open Network Stream` -> paste your `rtsp://` URL.
- If VLC cannot connect, the camera IP, port, or password is incorrect.

### 2. URL-Encoding Credentials
If your camera password contains special characters like `@`, `:`, `#`, URL-encode them:
- `@` becomes `%40`
- `#` becomes `%23`
- `:` becomes `%3A`

### 3. High CPU Usage
- Set the camera's encoding mode to **Stream Copy (`copy`)**. If your camera already outputs H.264, FFmpeg copies video packets without decoding, lowering CPU usage to **< 1%**.
