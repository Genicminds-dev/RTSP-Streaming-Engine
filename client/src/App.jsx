import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import {
  Camera,
  Play,
  CircleStop,
  RefreshCw,
  Wifi,
  WifiOff,
  Loader2,
  Maximize,
  Minimize,
  Download,
  Plus,
  Trash2,
  Copy,
  Check,
  ExternalLink,
  Code2,
  Video,
  AlertCircle
} from "lucide-react";

export default function App() {
  const [cameras, setCameras] = useState([]);
  const [activeCameraId, setActiveCameraId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState(null); // id of camera being started/stopped
  const [showAddModal, setShowAddModal] = useState(false);
  const [showIntegrationModal, setShowIntegrationModal] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [bannerMessage, setBannerMessage] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // New Camera Form State
  const [formData, setFormData] = useState({
    name: "",
    rtspUrl: "",
    codec: "libx264"
  });
  const [formError, setFormError] = useState("");

  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const hlsRef = useRef(null);
  const heartbeatTimer = useRef(null);

  const API_BASE_URL = "https://lawngreen-spider-136291.hostingersite.com";
  // const API_BASE_URL = "http://localhost:4000";
  // Fetch all registered cameras
  const fetchCameras = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/cameras`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCameras(data);

      // Auto-select first camera if none selected
      setActiveCameraId((prev) => {
        if (!prev && data.length > 0) return data[0].id;
        if (prev && !data.some((c) => c.id === prev)) return data[0]?.id || null;
        return prev;
      });
      return data;
    } catch (err) {
      console.error("Failed to fetch cameras:", err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const activeCamera = cameras.find((c) => c.id === activeCameraId) || null;

  // Cleanly tear down current HLS player
  const destroyPlayer = useCallback(() => {
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
  }, []);

  // Initialize HLS player for the active camera
  const initPlayer = useCallback(() => {
    if (!activeCamera || !activeCamera.playlistReady) {
      destroyPlayer();
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    destroyPlayer();
    video.muted = true;
    const streamSrc = `${activeCamera.streamUrl}?t=${Date.now()}`;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 0,
        liveSyncDurationCount: 1,
        liveMaxLatencyDurationCount: 3,
        maxBufferLength: 4,
        maxMaxBufferLength: 8,
        manifestLoadingMaxRetry: 8,
        manifestLoadingRetryDelay: 800
      });

      hlsRef.current = hls;
      hls.loadSource(streamSrc);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setTimeout(() => {
            if (hlsRef.current) hls.loadSource(`${activeCamera.streamUrl}?t=${Date.now()}`);
          }, 1200);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          setTimeout(initPlayer, 2000);
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamSrc;
      video.play().catch(() => {});
    }
  }, [activeCamera, destroyPlayer]);

  // Sync player whenever active camera or readiness changes
  useEffect(() => {
    if (activeCamera?.running && activeCamera?.playlistReady) {
      initPlayer();
    } else {
      destroyPlayer();
    }
  }, [activeCamera?.id, activeCamera?.running, activeCamera?.playlistReady, initPlayer, destroyPlayer]);

  // Periodic heartbeat poll
  useEffect(() => {
    fetchCameras();
    heartbeatTimer.current = setInterval(fetchCameras, 3000);

    const onFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);

    return () => {
      clearInterval(heartbeatTimer.current);
      document.removeEventListener("fullscreenchange", onFullscreen);
      destroyPlayer();
    };
  }, [fetchCameras, destroyPlayer]);

  // Start stream for a specific camera
  async function handleStartStream(camId) {
    setBusyAction(camId);
    try {
      const res = await fetch(`${API_BASE_URL}/api/cameras/${camId}/start`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start stream");
      setBannerMessage({ type: "success", text: `Stream started for camera: ${camId}` });
      await fetchCameras();
      setActiveCameraId(camId);
    } catch (err) {
      setBannerMessage({ type: "error", text: err.message });
    } finally {
      setBusyAction(null);
    }
  }

  // Stop stream for a specific camera
  async function handleStopStream(camId) {
    setBusyAction(camId);
    try {
      const res = await fetch(`${API_BASE_URL}/api/cameras/${camId}/stop`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to stop stream");
      setBannerMessage({ type: "info", text: `Stream stopped for camera: ${camId}` });
      if (activeCameraId === camId) {
        destroyPlayer();
      }
      await fetchCameras();
    } catch (err) {
      setBannerMessage({ type: "error", text: err.message });
    } finally {
      setBusyAction(null);
    }
  }

  // Register new camera
  async function handleAddCamera(e) {
    e.preventDefault();
    setFormError("");

    if (!formData.name.trim() || !formData.rtspUrl.trim()) {
      setFormError("Please fill out both Camera Name and RTSP URL.");
      return;
    }
    if (!formData.rtspUrl.startsWith("rtsp://")) {
      setFormError("RTSP URL must start with 'rtsp://'");
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/cameras`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to register camera");

      setShowAddModal(false);
      setFormData({ name: "", rtspUrl: "", codec: "libx264" });
      setBannerMessage({ type: "success", text: `Camera '${data.camera.name}' added successfully!` });
      await fetchCameras();
      setActiveCameraId(data.camera.id);
    } catch (err) {
      setFormError(err.message);
    }
  }

  // Delete camera
  async function handleDeleteCamera(camId, camName) {
    if (!window.confirm(`Are you sure you want to delete '${camName}' (${camId})?`)) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/cameras/${camId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete camera");
      }
      setBannerMessage({ type: "info", text: `Camera '${camName}' deleted.` });
      if (activeCameraId === camId) {
        destroyPlayer();
        setActiveCameraId(null);
      }
      await fetchCameras();
    } catch (err) {
      setBannerMessage({ type: "error", text: err.message });
    }
  }

  // Copy helper
  function copyToClipboard(text, id) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // Capture snapshot from active video frame
  function captureSnapshot() {
    const video = videoRef.current;
    if (!video || !activeCamera?.playlistReady) return;

    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      const link = document.createElement("a");
      link.download = `${activeCamera.id}-snapshot-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (err) {
      console.error("Snapshot error:", err);
    }
  }

  function toggleFullscreen() {
    const stage = stageRef.current;
    if (!stage) return;
    if (!document.fullscreenElement) {
      stage.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  const liveCamerasCount = cameras.filter((c) => c.status === "online").length;

  return (
    <main className="app-shell">
      {/* Top Navbar */}
      <header className="topbar">
        <div className="brand-mark">
          <Camera size={22} />
        </div>
        <div className="brand-copy">
          <h1>Smart Neckband Camera Hub</h1>
          <p>Dynamic Multi-Camera RTSP Streaming Engine</p>
        </div>

        <div className="topbar-actions">
          <button
            className="btn btn-secondary"
            onClick={() => setShowIntegrationModal(true)}
            title="Get integration code for Smart Neckband Portal"
          >
            <Code2 size={16} /> Portal Integration
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowAddModal(true)}
            title="Register a new RTSP camera"
          >
            <Plus size={16} /> Add Camera
          </button>
          <div className="connection-pill online">
            <Wifi size={15} />
            <span>{liveCamerasCount} of {cameras.length} Live</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="content">
        {/* Banner Alert */}
        {bannerMessage && (
          <div className={`alert-banner ${bannerMessage.type}`}>
            <span>{bannerMessage.text}</span>
            <button className="banner-close" onClick={() => setBannerMessage(null)}>✕</button>
          </div>
        )}

        {/* Top Split Layout: Active Player on Left/Top, Camera List on Right/Bottom */}
        <div className="dashboard-grid">
          {/* Main Video Monitor */}
          <section className="video-card">
            <div className="video-toolbar">
              <div className="camera-title">
                <span className={`live-dot ${activeCamera?.status === "online" ? "active" : activeCamera?.status === "connecting" ? "buffering" : ""}`} />
                <strong>{activeCamera?.name || "No Camera Selected"}</strong>
                {activeCamera && (
                  <span className="camera-slug">({activeCamera.id})</span>
                )}
                {activeCamera?.uptimeSeconds != null && (
                  <span className="uptime-tag">Up {Math.floor(activeCamera.uptimeSeconds / 60)}m {activeCamera.uptimeSeconds % 60}s</span>
                )}
              </div>

              <div className="toolbar-controls">
                {activeCamera?.status === "online" && (
                  <button className="icon-button" title="Capture Snapshot" onClick={captureSnapshot}>
                    <Download size={16} />
                  </button>
                )}
                <button className="icon-button" title="Toggle Fullscreen" onClick={toggleFullscreen}>
                  {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                </button>
                <button className="icon-button" title="Refresh Cameras" onClick={fetchCameras}>
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>

            <div className="video-stage" ref={stageRef}>
              <video ref={videoRef} controls muted playsInline autoPlay />

              {(!activeCamera || activeCamera.status === "offline") && (
                <div className="video-placeholder">
                  <div className="placeholder-icon">
                    <Camera size={38} />
                  </div>
                  <h3>Stream is Offline</h3>
                  <p>
                    {activeCamera
                      ? `Click 'Start Stream' to connect to ${activeCamera.name}.`
                      : "Add or select a camera to start monitoring."}
                  </p>
                  {activeCamera && (
                    <button
                      className="btn btn-primary"
                      style={{ marginTop: 14 }}
                      onClick={() => handleStartStream(activeCamera.id)}
                      disabled={busyAction === activeCamera.id}
                    >
                      {busyAction === activeCamera.id ? <Loader2 size={16} className="spin" /> : <Play size={16} fill="currentColor" />}
                      Start Stream
                    </button>
                  )}
                </div>
              )}

              {activeCamera?.status === "connecting" && (
                <div className="video-placeholder">
                  <div className="placeholder-icon">
                    <Loader2 size={38} className="spin" />
                  </div>
                  <h3>Connecting to Camera...</h3>
                  <p>FFmpeg is ingesting RTSP feed and preparing HLS segments. Live playback will begin shortly.</p>
                </div>
              )}

              {activeCamera?.status === "error" && (
                <div className="video-placeholder">
                  <div className="placeholder-icon" style={{ borderColor: "#ef4444", color: "#ef4444" }}>
                    <AlertCircle size={38} />
                  </div>
                  <h3 style={{ color: "#f87171" }}>Stream Connection Failed</h3>
                  <p>{activeCamera.error || "Could not reach camera. Verify IP, port, and credentials."}</p>
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: 14 }}
                    onClick={() => handleStartStream(activeCamera.id)}
                    disabled={busyAction === activeCamera.id}
                  >
                    Retry Connection
                  </button>
                </div>
              )}
            </div>

            <div className="video-footer">
              <div className="stream-url-display">
                <span className="muted">Stream URL:</span>
                <code>{activeCamera ? activeCamera.streamUrl : "—"}</code>
                {activeCamera && (
                  <button
                    className="copy-btn"
                    title="Copy Stream URL"
                    onClick={() => copyToClipboard(activeCamera.streamUrl, "active-url")}
                  >
                    {copiedId === "active-url" ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                  </button>
                )}
              </div>

              <div className="footer-details">
                {activeCamera && (
                  <a
                    href={activeCamera.embedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="link-pill"
                    title="Open standalone iframe embed player"
                  >
                    <ExternalLink size={13} /> Standalone Player
                  </a>
                )}
              </div>
            </div>
          </section>

          {/* Camera List & Quick Management */}
          <section className="cameras-panel">
            <div className="panel-header">
              <div>
                <h3>Registered Cameras ({cameras.length})</h3>
                <p className="subheading">Select to view, start, or stop individual feeds.</p>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowAddModal(true)}>
                <Plus size={14} /> Add
              </button>
            </div>

            {loading ? (
              <div className="panel-loading">
                <Loader2 size={24} className="spin" />
                <p>Loading registered cameras...</p>
              </div>
            ) : cameras.length === 0 ? (
              <div className="panel-empty">
                <Video size={36} />
                <h4>No Cameras Registered</h4>
                <p>Add your first camera using its RTSP stream URL to begin.</p>
                <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                  Add Camera
                </button>
              </div>
            ) : (
              <div className="camera-list">
                {cameras.map((cam) => {
                  const isSelected = cam.id === activeCameraId;
                  const isBusy = busyAction === cam.id;

                  return (
                    <div
                      key={cam.id}
                      className={`camera-item ${isSelected ? "selected" : ""} ${cam.status}`}
                      onClick={() => setActiveCameraId(cam.id)}
                    >
                      <div className="cam-item-main">
                        <div className="cam-item-header">
                          <span className={`live-dot ${cam.status === "online" ? "active" : cam.status === "connecting" ? "buffering" : ""}`} />
                          <h4 className="cam-name">{cam.name}</h4>
                          <span className="cam-badge">{cam.codec}</span>
                        </div>
                        <p className="cam-meta">ID: <code>{cam.id}</code></p>
                        <span className={`status-pill ${cam.status}`}>
                          {cam.status === "online" ? "Streaming Live" : cam.status === "connecting" ? "Buffering..." : cam.status === "error" ? "Error" : "Offline"}
                        </span>
                      </div>

                      <div className="cam-item-actions" onClick={(e) => e.stopPropagation()}>
                        {cam.running ? (
                          <button
                            className="btn-action stop"
                            title="Stop Stream"
                            disabled={isBusy}
                            onClick={() => handleStopStream(cam.id)}
                          >
                            {isBusy ? <Loader2 size={15} className="spin" /> : <CircleStop size={15} />}
                          </button>
                        ) : (
                          <button
                            className="btn-action start"
                            title="Start Stream"
                            disabled={isBusy}
                            onClick={() => handleStartStream(cam.id)}
                          >
                            {isBusy ? <Loader2 size={15} className="spin" /> : <Play size={15} fill="currentColor" />}
                          </button>
                        )}

                        <button
                          className="btn-action"
                          title="Copy Public HLS Stream URL"
                          onClick={() => copyToClipboard(cam.streamUrl, `url-${cam.id}`)}
                        >
                          {copiedId === `url-${cam.id}` ? <Check size={15} color="#10b981" /> : <Copy size={15} />}
                        </button>

                        <button
                          className="btn-action delete"
                          title="Delete Camera"
                          onClick={() => handleDeleteCamera(cam.id, cam.name)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Add Camera Modal */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Register New RTSP Camera</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>✕</button>
            </div>

            <form onSubmit={handleAddCamera}>
              {formError && <div className="form-error">{formError}</div>}

              <div className="form-group">
                <label>Camera Name / Location *</label>
                <input
                  type="text"
                  placeholder="e.g., Main Entrance, Warehouse Gate, Lab 01"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>RTSP Stream URL * (Kept secure on backend)</label>
                <input
                  type="text"
                  placeholder="rtsp://username:password@ip_address:port/path"
                  value={formData.rtspUrl}
                  onChange={(e) => setFormData({ ...formData, rtspUrl: e.target.value })}
                  required
                />
                <small className="help-text">Credentials are kept strictly on the streaming server and never sent to clients.</small>
              </div>

              <div className="form-group">
                <label>Encoding Mode</label>
                <select
                  value={formData.codec}
                  onChange={(e) => setFormData({ ...formData, codec: e.target.value })}
                >
                  <option value="libx264">Transcode to H.264 (libx264) — Universal Compatibility</option>
                  <option value="copy">Stream Copy (copy) — Zero CPU (use if camera already outputs H.264)</option>
                </select>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Camera
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Portal Integration Helper Modal */}
      {showIntegrationModal && (
        <div className="modal-backdrop" onClick={() => setShowIntegrationModal(false)}>
          <div className="modal-card modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Smart Neckband Portal Integration Guide</h3>
              <button className="modal-close" onClick={() => setShowIntegrationModal(false)}>✕</button>
            </div>

            <div className="integration-content">
              <p className="intro-text">
                Integrate dynamic camera streaming into your existing <b>Smart Neckband Portal</b> using either of these three methods:
              </p>

              <div className="integration-method">
                <h4>Method 1: Frictionless Iframe Embed (Single Line of Code)</h4>
                <p>Embed the live stream player directly into any page or modal in your portal:</p>
                <pre>
                  <code>{`<iframe\n  src="${activeCamera ? activeCamera.embedUrl : "https://your-domain.com/embed/cam-01"}"\n  width="100%"\n  height="480"\n  frameborder="0"\n  allow="autoplay; fullscreen"\n  allowfullscreen>\n</iframe>`}</code>
                </pre>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => copyToClipboard(`<iframe src="${activeCamera ? activeCamera.embedUrl : "https://your-domain.com/embed/cam-01"}" width="100%" height="480" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>`, "iframe-code")}
                >
                  {copiedId === "iframe-code" ? <Check size={14} color="#10b981" /> : <Copy size={14} />} Copy Iframe Code
                </button>
              </div>

              {/* <div className="integration-method">
                <h4>Method 2: REST API for Dynamic Multi-Camera Switching</h4>
                <p>Fetch the live list of registered cameras and stream endpoints from your portal backend or frontend:</p>
                <pre>
                  <code>{`// Fetch available cameras dynamically\nconst res = await fetch("https://lawngreen-spider-136291.hostingersite.com/api/cameras");\nconst cameras = await res.json();\n\n// Returns: [{ id, name, status, streamUrl, embedUrl }, ...]`}</code>
                </pre>
              </div> */}

              <div className="integration-method">
                <h4>Method 3: Native Hls.js in HTML5 Video</h4>
                <p>Play the direct HLS stream directly inside any custom React or HTML5 video player:</p>
                <pre>
                  <code>{`import Hls from "hls.js";\n\nif (Hls.isSupported()) {\n  const hls = new Hls({ lowLatencyMode: true });\n  hls.loadSource("${activeCamera ? activeCamera.streamUrl : "https://your-domain.com/streams/cam-01/index.m3u8"}");\n  hls.attachMedia(videoElement);\n}`}</code>
                </pre>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setShowIntegrationModal(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
