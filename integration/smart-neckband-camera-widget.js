/**
 * Smart Neckband Camera Widget (Vanilla JS & CSS)
 * 
 * Drop this script into any website or portal to add instant multi-camera live streaming.
 * Usage:
 *   1. Include this script: <script src="https://camera.yourdomain.com/widget.js"></script>
 *   2. Add a button: <button onclick="openSmartNeckbandCameraModal()">View Live Cameras</button>
 */

(function () {
  const STREAMING_SERVER_URL = window.SMART_NECKBAND_STREAM_SERVER || window.location.origin;

  // Dynamically inject Hls.js if not already present on page
  if (!window.Hls) {
    const hlsScript = document.createElement("script");
    hlsScript.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.18/dist/hls.min.js";
    document.head.appendChild(hlsScript);
  }

  // Inject widget CSS styles
  const styleEl = document.createElement("style");
  styleEl.textContent = `
    .snb-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.75);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      padding: 16px;
    }
    .snb-modal-card {
      background: #0f172a;
      color: #fff;
      border-radius: 14px;
      width: 100%;
      max-width: 820px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.1);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .snb-modal-header {
      padding: 14px 18px;
      background: #1e293b;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .snb-modal-header h3 { margin: 0; font-size: 15px; font-weight: 600; }
    .snb-modal-close {
      background: transparent;
      border: 0;
      color: #94a3b8;
      font-size: 18px;
      cursor: pointer;
      line-height: 1;
    }
    .snb-modal-close:hover { color: #fff; }
    .snb-camera-bar {
      padding: 10px 18px;
      background: #09101d;
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .snb-camera-select {
      background: #1e293b;
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      outline: none;
      flex: 1;
      max-width: 320px;
    }
    .snb-video-stage {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 9;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .snb-video-stage video { width: 100%; height: 100%; object-fit: contain; }
    .snb-loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      color: #94a3b8;
    }
    .snb-spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(255,255,255,0.2);
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: snbSpin 1s linear infinite;
      margin-bottom: 10px;
    }
    @keyframes snbSpin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(styleEl);

  let currentHls = null;
  let pollTimer = null;

  // Main modal open function
  window.openSmartNeckbandCameraModal = async function (preferredCameraId) {
    // Remove any existing modal
    const existing = document.getElementById("snbCameraModal");
    if (existing) existing.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "snbCameraModal";
    backdrop.className = "snb-modal-backdrop";

    backdrop.innerHTML = `
      <div class="snb-modal-card">
        <div class="snb-modal-header">
          <h3>Smart Neckband — Live Camera Feeds</h3>
          <button class="snb-modal-close" id="snbCloseBtn">✕</button>
        </div>
        <div class="snb-camera-bar">
          <label style="font-size: 12px; color: #94a3b8;">Select Camera:</label>
          <select class="snb-camera-select" id="snbCamSelect">
            <option value="">Loading cameras...</option>
          </select>
        </div>
        <div class="snb-video-stage">
          <video id="snbVideo" autoplay playsinline muted controls></video>
          <div class="snb-loading-overlay" id="snbLoader">
            <div class="snb-spinner"></div>
            <span id="snbLoaderText">Connecting to camera stream...</span>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const closeBtn = document.getElementById("snbCloseBtn");
    const camSelect = document.getElementById("snbCamSelect");
    const video = document.getElementById("snbVideo");
    const loader = document.getElementById("snbLoader");
    const loaderText = document.getElementById("snbLoaderText");

    function closeModal() {
      if (currentHls) {
        currentHls.destroy();
        currentHls = null;
      }
      if (pollTimer) clearInterval(pollTimer);
      backdrop.remove();
    }

    closeBtn.onclick = closeModal;
    backdrop.onclick = (e) => {
      if (e.target === backdrop) closeModal();
    };

    // Load available cameras
    try {
      const res = await fetch(`${STREAMING_SERVER_URL}/api/cameras`);
      const cameras = await res.json();

      camSelect.innerHTML = "";
      if (!cameras || cameras.length === 0) {
        camSelect.innerHTML = "<option>No cameras registered</option>";
        loaderText.textContent = "No cameras registered in the streaming hub.";
        return;
      }

      cameras.forEach((cam) => {
        const opt = document.createElement("option");
        opt.value = cam.id;
        opt.textContent = `${cam.name} (${cam.status})`;
        camSelect.appendChild(opt);
      });

      if (preferredCameraId && cameras.some((c) => c.id === preferredCameraId)) {
        camSelect.value = preferredCameraId;
      }

      function switchCamera(camId) {
        if (currentHls) {
          currentHls.destroy();
          currentHls = null;
        }
        if (pollTimer) clearInterval(pollTimer);

        loader.style.display = "flex";
        loaderText.textContent = "Connecting to camera stream...";

        // Start stream if needed
        fetch(`${STREAMING_SERVER_URL}/api/cameras/${camId}/start`, { method: "POST" }).catch(() => {});

        let attempts = 0;
        pollTimer = setInterval(async () => {
          attempts++;
          try {
            const statusRes = await fetch(`${STREAMING_SERVER_URL}/api/cameras/${camId}/status`);
            const status = await statusRes.json();
            if (status.playlistReady) {
              clearInterval(pollTimer);
              loader.style.display = "none";
              playStream(status.streamUrl);
            } else if (attempts >= 15) {
              clearInterval(pollTimer);
              loaderText.textContent = "Camera stream timed out. Please check camera connection.";
            }
          } catch {}
        }, 1000);
      }

      function playStream(streamUrl) {
        video.muted = true;
        if (window.Hls && window.Hls.isSupported()) {
          currentHls = new window.Hls({ lowLatencyMode: true });
          currentHls.loadSource(`${streamUrl}?t=${Date.now()}`);
          currentHls.attachMedia(video);
          currentHls.on(window.Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = `${streamUrl}?t=${Date.now()}`;
          video.play().catch(() => {});
        }
      }

      camSelect.onchange = () => switchCamera(camSelect.value);
      switchCamera(camSelect.value);
    } catch (err) {
      loaderText.textContent = "Could not connect to streaming service.";
    }
  };
})();
