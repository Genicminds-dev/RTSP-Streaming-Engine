import React, { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";

/**
 * SmartNeckbandCameraViewer
 * Drop-in React component for the Smart Neckband Portal.
 * 
 * Props:
 * - serverUrl: Base URL of the deployed streaming backend (e.g. "https://camera.yourdomain.com")
 * - defaultCameraId: (Optional) Initial camera ID to select
 * - autoPlay: (Optional) boolean, defaults to true
 * - className: (Optional) custom CSS class
 */
export default function SmartNeckbandCameraViewer({
  serverUrl = "http://localhost:4000",
  defaultCameraId = null,
  autoPlay = true,
  className = ""
}) {
  const [cameras, setCameras] = useState([]);
  const [selectedId, setSelectedId] = useState(defaultCameraId);
  const [loading, setLoading] = useState(true);
  const [streamReady, setStreamReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const pollTimerRef = useRef(null);

  const cleanServerUrl = serverUrl.replace(/\/+$/, "");

  // Fetch available cameras from the streaming server
  const loadCameras = useCallback(async () => {
    try {
      const res = await fetch(`${cleanServerUrl}/api/cameras`);
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      const data = await res.json();
      setCameras(data);

      setSelectedId((prev) => {
        if (!prev && data.length > 0) return data[0].id;
        if (prev && !data.some((c) => c.id === prev)) return data[0]?.id || null;
        return prev;
      });
      return data;
    } catch (err) {
      console.error("[SmartNeckbandCameraViewer] Failed to load cameras:", err);
      setErrorMsg("Unable to connect to camera streaming service.");
      return [];
    } finally {
      setLoading(false);
    }
  }, [cleanServerUrl]);

  const selectedCamera = cameras.find((c) => c.id === selectedId) || null;

  // Cleanup HLS instance
  const destroyPlayer = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    setStreamReady(false);
  }, []);

  // Initialize playback using Hls.js
  const attachPlayer = useCallback((streamUrl) => {
    const video = videoRef.current;
    if (!video) return;

    destroyPlayer();
    video.muted = true;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        liveSyncDurationCount: 1,
        liveMaxLatencyDurationCount: 3,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 1000
      });
      hlsRef.current = hls;

      hls.loadSource(`${streamUrl}?t=${Date.now()}`);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStreamReady(true);
        if (autoPlay) video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setTimeout(() => {
            if (hlsRef.current) hls.loadSource(`${streamUrl}?t=${Date.now()}`);
          }, 1200);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          setStreamReady(false);
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = `${streamUrl}?t=${Date.now()}`;
      video.addEventListener("loadedmetadata", () => {
        setStreamReady(true);
        if (autoPlay) video.play().catch(() => {});
      });
    }
  }, [autoPlay, destroyPlayer]);

  // Ensure stream is active when camera is selected
  useEffect(() => {
    if (!selectedCamera) return;

    async function ensureStreamActive() {
      setErrorMsg(null);
      // Auto-trigger stream start if currently offline
      if (!selectedCamera.running) {
        try {
          await fetch(`${cleanServerUrl}/api/cameras/${selectedCamera.id}/start`, { method: "POST" });
        } catch {}
      }

      // Check readiness
      let attempts = 0;
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(async () => {
        attempts++;
        try {
          const res = await fetch(`${cleanServerUrl}/api/cameras/${selectedCamera.id}/status`);
          if (!res.ok) return;
          const status = await res.json();
          if (status.playlistReady) {
            clearInterval(pollTimerRef.current);
            attachPlayer(status.streamUrl);
          } else if (attempts >= 15) {
            clearInterval(pollTimerRef.current);
            setErrorMsg("Camera feed timed out. Verify camera power and network.");
          }
        } catch {}
      }, 1000);
    }

    ensureStreamActive();

    return () => destroyPlayer();
  }, [selectedCamera?.id, cleanServerUrl, attachPlayer, destroyPlayer]);

  // Initial camera fetch & periodic check
  useEffect(() => {
    loadCameras();
    const interval = setInterval(loadCameras, 5000);
    return () => clearInterval(interval);
  }, [loadCameras]);

  return (
    <div className={`smart-neckband-camera-box ${className}`} style={containerStyles}>
      {/* Camera Selection Header */}
      <div style={headerStyles}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: streamReady ? "#10b981" : "#f59e0b",
            boxShadow: streamReady ? "0 0 0 3px rgba(16, 185, 129, 0.2)" : "none"
          }} />
          <strong style={{ fontSize: 14, color: "#0f172a" }}>
            {selectedCamera?.name || "Live Camera"}
          </strong>
        </div>

        {/* Dropdown for dynamic camera switching */}
        {cameras.length > 1 && (
          <select
            value={selectedId || ""}
            onChange={(e) => setSelectedId(e.target.value)}
            style={selectStyles}
          >
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.status === "online" ? "● (Live)" : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Video Viewport */}
      <div style={stageStyles}>
        <video
          ref={videoRef}
          controls
          muted
          playsInline
          autoPlay={autoPlay}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />

        {!streamReady && (
          <div style={overlayStyles}>
            {errorMsg ? (
              <div style={{ color: "#ef4444", textAlign: "center" }}>
                <p style={{ fontWeight: 600, margin: "0 0 6px" }}>Stream Unavailable</p>
                <p style={{ fontSize: 12, margin: 0, opacity: 0.85 }}>{errorMsg}</p>
              </div>
            ) : (
              <div style={{ color: "#fff", textAlign: "center" }}>
                <div style={spinnerStyles} />
                <p style={{ margin: "10px 0 0", fontSize: 13, fontWeight: 500 }}>
                  Connecting to live camera...
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div style={footerStyles}>
        <span style={{ fontSize: 11, color: "#64748b" }}>
          {streamReady ? "● Real-Time Streaming" : "Initializing connection..."}
        </span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>
          Smart Neckband Integrated Stream
        </span>
      </div>
    </div>
  );
}

// Inline CSS Styles for zero-dependency integration
const containerStyles = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  overflow: "hidden",
  boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
  fontFamily: "system-ui, -apple-system, sans-serif"
};

const headerStyles = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 16px",
  borderBottom: "1px solid #edf2f7",
  background: "#f8fafc"
};

const selectStyles = {
  padding: "6px 12px",
  borderRadius: "6px",
  border: "1px solid #cbd5e1",
  fontSize: "12px",
  background: "#fff",
  color: "#334155",
  outline: "none"
};

const stageStyles = {
  position: "relative",
  width: "100%",
  aspectRatio: "16 / 9",
  background: "#09101d",
  display: "flex",
  alignItems: "center",
  justifyContent: "center"
};

const overlayStyles = {
  position: "absolute",
  inset: 0,
  background: "rgba(9, 16, 29, 0.9)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px"
};

const spinnerStyles = {
  width: 32,
  height: 32,
  border: "3px solid rgba(255,255,255,0.2)",
  borderTopColor: "#3b82f6",
  borderRadius: "50%",
  animation: "spin 1s linear infinite",
  margin: "0 auto"
};

const footerStyles = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 16px",
  background: "#f8fafc",
  borderTop: "1px solid #edf2f7"
};
