# Smart Neckband Portal — Camera Streaming Integration Guide

This guide details how to integrate your live RTSP camera feeds into your existing **Smart Neckband Portal** website.

---

## 🎯 Integration Options at a Glance

| Method | Best For | Complexity | Dependencies |
| :--- | :--- | :--- | :--- |
| **Option 1: Iframe Embed** | Fast embed inside existing modal or dashboard page | ⭐ 1 line of code | None |
| **Option 2: React Component** | Portals built with React / Next.js / Vite | ⭐⭐ Native UI integration | `react`, `hls.js` |
| **Option 3: Vanilla JS Widget** | Portals built with HTML, PHP, WordPress, Laravel | ⭐ Single `<script>` tag | None |
| **Option 4: Custom REST API** | Custom UI with proprietary video players | ⭐⭐⭐ Full control | Any HTTP client |

---

## 🚀 Option 1: Iframe Embed (Recommended & Fastest)

Every camera registered in the streaming hub automatically has a dedicated, responsive, standalone player URL at:
```
https://<your-streaming-domain>/embed/<camera-id>
```

### In React / JSX:
```jsx
export function CameraModal({ cameraId, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ width: "90%", maxWidth: 840 }}>
        <iframe
          src={`https://camera.yourdomain.com/embed/${cameraId}`}
          width="100%"
          height="480"
          style={{ border: "none", borderRadius: "10px" }}
          allow="autoplay; fullscreen"
          allowFullScreen
        />
      </div>
    </div>
  );
}
```

### In Plain HTML / PHP:
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

---

## ⚛️ Option 2: Native React Component Integration

Copy [`SmartNeckbandCameraViewer.jsx`](./SmartNeckbandCameraViewer.jsx) into your Smart Neckband Portal's `src/components/` folder.

### Installation in your Portal:
```bash
npm install hls.js
```

### Usage:
```jsx
import SmartNeckbandCameraViewer from "./components/SmartNeckbandCameraViewer";

export default function SmartNeckbandDashboard() {
  return (
    <div className="dashboard-container">
      <h2>Live Camera Monitoring</h2>
      
      {/* Self-contained multi-camera viewer with dynamic camera dropdown */}
      <SmartNeckbandCameraViewer
        serverUrl="https://camera.yourdomain.com"
        autoPlay={true}
      />
    </div>
  );
}
```

**Features provided automatically:**
- Auto-fetches all registered cameras from the backend
- Allows switching between multiple cameras via dropdown
- Low-latency HLS.js streaming
- Automatic stream initiation if camera was idle
- Live connection indicator and error recovery

---

## 🌐 Option 3: Vanilla JavaScript Widget

Include the lightweight widget script in your portal's `<head>` or before `</body>`:

```html
<!-- 1. Configure backend URL and load widget -->
<script>
  window.SMART_NECKBAND_STREAM_SERVER = "https://camera.yourdomain.com";
</script>
<script src="https://camera.yourdomain.com/widget.js"></script>

<!-- 2. Trigger the modal popup on click -->
<button onclick="openSmartNeckbandCameraModal()">
  📹 View Live Cameras
</button>
```

When clicked, this automatically opens a responsive dark-themed modal popup displaying live video and a camera switcher dropdown!

---

## 🔌 Option 4: Custom REST API Integration

If you want to build a completely custom UI inside the Smart Neckband Portal, query the REST API directly:

### 1. Fetch Registered Cameras:
```javascript
const response = await fetch("https://camera.yourdomain.com/api/cameras");
const cameras = await response.json();
console.log(cameras);
```

**Example JSON Response:**
```json
[
  {
    "id": "cam-01",
    "name": "Main Entrance",
    "codec": "libx264",
    "status": "online",
    "running": true,
    "playlistReady": true,
    "uptimeSeconds": 184,
    "streamUrl": "https://camera.yourdomain.com/streams/cam-01/index.m3u8",
    "embedUrl": "https://camera.yourdomain.com/embed/cam-01"
  },
  {
    "id": "warehouse-gate",
    "name": "Warehouse Gate",
    "codec": "copy",
    "status": "offline",
    "running": false,
    "playlistReady": false,
    "uptimeSeconds": null,
    "streamUrl": "https://camera.yourdomain.com/streams/warehouse-gate/index.m3u8",
    "embedUrl": "https://camera.yourdomain.com/embed/warehouse-gate"
  }
]
```

### 2. Start a Camera Stream On-Demand:
```javascript
await fetch("https://camera.yourdomain.com/api/cameras/warehouse-gate/start", {
  method: "POST"
});
```

### 3. Stop a Camera Stream:
```javascript
await fetch("https://camera.yourdomain.com/api/cameras/warehouse-gate/stop", {
  method: "POST"
});
```

---

## 🔒 Security Best Practices
- The camera's native RTSP URL and credentials (`admin:password`) are **never exposed** in the API or client code.
- Only the sanitized `.m3u8` stream URL and camera metadata are returned.
- If you deploy with `ADMIN_API_KEY`, pass the header `x-api-key: your-secret-key` when registering or deleting cameras.
