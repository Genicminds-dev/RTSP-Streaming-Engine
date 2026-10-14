import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class CameraManager {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(__dirname, "data");
    this.storageFile = path.join(this.dataDir, "cameras.json");
    this.streamsBaseDir = options.streamsBaseDir || path.join(__dirname, "public", "streams");
    this.ffmpegPath = options.ffmpegPath || process.env.FFMPEG_PATH || "ffmpeg";
    this.defaultCodec = (process.env.VIDEO_CODEC || "libx264").trim().toLowerCase();
    this.segmentSeconds = Math.max(1, Number(process.env.HLS_SEGMENT_SECONDS || 2));
    this.listSize = Math.max(3, Number(process.env.HLS_LIST_SIZE || 5));
    this.publicBaseUrl = options.publicBaseUrl || process.env.PUBLIC_URL || "";

    // In-memory active stream state: Map<cameraId, StreamState>
    this.activeStreams = new Map();

    this.initStorage();
  }

  // Initialize storage directory and seed default camera if empty
  initStorage() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.streamsBaseDir)) {
      fs.mkdirSync(this.streamsBaseDir, { recursive: true });
    }

    if (!fs.existsSync(this.storageFile)) {
      const defaultRtsp = (process.env.RTSP_URL || "").trim();
      const initialCameras = [];

      if (defaultRtsp && !defaultRtsp.includes("192.168.1.100")) {
        initialCameras.push({
          id: "cam-01",
          name: "Default IP Camera",
          rtspUrl: defaultRtsp,
          codec: this.defaultCodec,
          createdAt: new Date().toISOString()
        });
      }

      fs.writeFileSync(this.storageFile, JSON.stringify(initialCameras, null, 2), "utf8");
    }
  }

  // Read registered cameras from JSON
  readCameras() {
    try {
      const data = fs.readFileSync(this.storageFile, "utf8");
      return JSON.parse(data) || [];
    } catch (err) {
      console.error("[CameraManager] Error reading cameras.json:", err.message);
      return [];
    }
  }

  // Save cameras to JSON
  writeCameras(cameras) {
    try {
      fs.writeFileSync(this.storageFile, JSON.stringify(cameras, null, 2), "utf8");
    } catch (err) {
      console.error("[CameraManager] Error writing cameras.json:", err.message);
      throw new Error("Failed to persist camera data.");
    }
  }

  // Helper to construct a URL based on base or request host
  getBaseUrl(req) {
    if (this.publicBaseUrl) return this.publicBaseUrl.replace(/\/+$/, "");
    if (req) {
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
      const host = req.headers["x-forwarded-host"] || req.get("host");
      return `${protocol}://${host}`;
    }
    return "";
  }

  // Clean stream directory for a specific camera
  cleanupCameraDir(cameraId) {
    const camDir = path.join(this.streamsBaseDir, cameraId);
    if (!fs.existsSync(camDir)) return;
    try {
      const files = fs.readdirSync(camDir);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(camDir, file));
        } catch {}
      }
    } catch {}
  }

  // Check if HLS playlist has been generated and contains at least one TS segment
  isPlaylistReady(cameraId) {
    const active = this.activeStreams.get(cameraId);
    if (!active || !active.process || active.process.exitCode !== null) return false;
    const playlistPath = path.join(this.streamsBaseDir, cameraId, "index.m3u8");
    if (!fs.existsSync(playlistPath)) return false;
    try {
      const content = fs.readFileSync(playlistPath, "utf8");
      return content.includes(".ts");
    } catch {
      return false;
    }
  }

  // Get sanitized camera list for API / UI responses (RTSP credentials stripped)
  getAll(req) {
    const baseUrl = this.getBaseUrl(req);
    const cameras = this.readCameras();

    return cameras.map((cam) => {
      const active = this.activeStreams.get(cam.id);
      const isRunning = Boolean(active && active.process && active.process.exitCode === null);
      const playlistReady = isRunning && this.isPlaylistReady(cam.id);
      const uptimeSeconds = isRunning && active?.startedAt
        ? Math.floor((Date.now() - new Date(active.startedAt).getTime()) / 1000)
        : null;

      let status = "offline";
      if (isRunning) {
        status = playlistReady ? "online" : "connecting";
      } else if (active?.error) {
        status = "error";
      }

      return {
        id: cam.id,
        name: cam.name,
        codec: cam.codec || this.defaultCodec,
        status,
        running: isRunning,
        playlistReady,
        uptimeSeconds,
        error: isRunning ? null : (active?.error || null),
        streamUrl: `${baseUrl}/streams/${cam.id}/index.m3u8`,
        embedUrl: `${baseUrl}/embed/${cam.id}`,
        createdAt: cam.createdAt
      };
    });
  }

  // Get single camera details
  getById(id, req) {
    const cameras = this.getAll(req);
    return cameras.find((c) => c.id === id) || null;
  }

  // Get raw camera with RTSP URL (internal use only)
  getRawCamera(id) {
    const cameras = this.readCameras();
    return cameras.find((c) => c.id === id) || null;
  }

  // Register a new camera
  addCamera(payload) {
    const { name, rtspUrl, codec } = payload;
    if (!name || typeof name !== "string" || !name.trim()) {
      throw new Error("Camera name is required.");
    }
    if (!rtspUrl || typeof rtspUrl !== "string" || !rtspUrl.startsWith("rtsp://")) {
      throw new Error("A valid RTSP URL starting with 'rtsp://' is required.");
    }

    const cameras = this.readCameras();

    // Generate safe alphanumeric slug ID
    let slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!slug) slug = "camera";

    let id = slug;
    let counter = 1;
    while (cameras.some((c) => c.id === id)) {
      id = `${slug}-${counter}`;
      counter++;
    }

    const newCamera = {
      id,
      name: name.trim(),
      rtspUrl: rtspUrl.trim(),
      codec: (codec || this.defaultCodec).trim().toLowerCase(),
      createdAt: new Date().toISOString()
    };

    cameras.push(newCamera);
    this.writeCameras(cameras);

    // Create stream output directory for this camera
    const camDir = path.join(this.streamsBaseDir, id);
    fs.mkdirSync(camDir, { recursive: true });

    return newCamera;
  }

  // Update existing camera
  updateCamera(id, payload) {
    const cameras = this.readCameras();
    const index = cameras.findIndex((c) => c.id === id);
    if (index === -1) {
      throw new Error(`Camera with ID '${id}' not found.`);
    }

    const existing = cameras[index];
    if (payload.name && payload.name.trim()) {
      existing.name = payload.name.trim();
    }
    if (payload.rtspUrl && payload.rtspUrl.trim()) {
      if (!payload.rtspUrl.startsWith("rtsp://")) {
        throw new Error("RTSP URL must start with 'rtsp://'");
      }
      existing.rtspUrl = payload.rtspUrl.trim();
      // If RTSP URL changed and camera is streaming, restart stream
      if (this.activeStreams.has(id)) {
        this.stopStream(id);
      }
    }
    if (payload.codec) {
      existing.codec = payload.codec.trim().toLowerCase();
    }

    cameras[index] = existing;
    this.writeCameras(cameras);
    return existing;
  }

  // Remove a camera
  deleteCamera(id) {
    this.stopStream(id);
    const cameras = this.readCameras();
    const filtered = cameras.filter((c) => c.id !== id);
    if (filtered.length === cameras.length) {
      throw new Error(`Camera with ID '${id}' not found.`);
    }

    this.writeCameras(filtered);
    this.cleanupCameraDir(id);

    const camDir = path.join(this.streamsBaseDir, id);
    try {
      fs.rmSync(camDir, { recursive: true, force: true });
    } catch {}

    return true;
  }

  // Start FFmpeg stream conversion for a camera
  async startStream(id) {
    const camera = this.getRawCamera(id);
    if (!camera) {
      throw new Error(`Camera with ID '${id}' not found.`);
    }

    // Check if already active
    const current = this.activeStreams.get(id);
    if (current && current.process && current.process.exitCode === null && this.isPlaylistReady(id)) {
      return { message: "Stream is already running.", ready: true };
    }

    // Clean previous process and directory
    this.stopStream(id);

    const camDir = path.join(this.streamsBaseDir, id);
    fs.mkdirSync(camDir, { recursive: true });
    this.cleanupCameraDir(id);

    const playlistPath = path.join(camDir, "index.m3u8");
    const codec = camera.codec || this.defaultCodec;

    const streamState = {
      process: null,
      error: "",
      startedAt: new Date().toISOString()
    };
    this.activeStreams.set(id, streamState);

    // Optimized FFmpeg arguments for ultra-low latency RTSP to HLS conversion
    const args = [
      "-hide_banner",
      "-loglevel", "warning",
      "-analyzeduration", "1000000",
      "-probesize", "1000000",
      "-fflags", "nobuffer",
      "-flags", "low_delay",
      "-rtsp_transport", "tcp",
      "-i", camera.rtspUrl,
      "-an" // Strip audio for CCTV stream optimization
    ];

    if (codec === "copy") {
      args.push("-c:v", "copy");
    } else {
      args.push(
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-pix_fmt", "yuv420p",
        "-g", "25",
        "-keyint_min", "25",
        "-sc_threshold", "0"
      );
    }

    args.push(
      "-f", "hls",
      "-hls_time", String(this.segmentSeconds),
      "-hls_init_time", "1",
      "-hls_list_size", String(this.listSize),
      "-hls_flags", "delete_segments+temp_file+independent_segments",
      "-hls_segment_filename", path.join(camDir, "segment_%03d.ts"),
      playlistPath
    );

    try {
      const proc = spawn(this.ffmpegPath, args, { windowsHide: true });
      streamState.process = proc;

      proc.stderr.on("data", (chunk) => {
        const line = chunk.toString().trim();
        if (line) {
          if (/error|failed|fatal|invalid|refused|denied|timed? ?out/i.test(line)) {
            streamState.error = line.slice(-1000);
          }
          console.error(`[ffmpeg:${id}]`, line);
        }
      });

      proc.on("error", (err) => {
        streamState.error = `Could not start FFmpeg (${err.message}). Check FFMPEG_PATH.`;
        console.error(`[ffmpeg:${id} error]`, streamState.error);
        streamState.process = null;
      });

      proc.on("close", (code) => {
        if (code !== 0 && code !== null) {
          console.warn(`[ffmpeg:${id}] Exited with code ${code}`);
        }
        streamState.process = null;
      });

      // Quick startup check (up to 1500ms)
      const startCheck = Date.now();
      let ready = false;
      while (Date.now() - startCheck < 1500) {
        if (!streamState.process || streamState.process.exitCode !== null) {
          throw new Error(streamState.error || "FFmpeg process exited unexpectedly. Check RTSP camera stream.");
        }
        if (this.isPlaylistReady(id)) {
          ready = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      return {
        message: ready ? "Stream connected and ready." : "FFmpeg started, buffering stream...",
        ready
      };
    } catch (err) {
      streamState.error = err.message;
      streamState.process = null;
      throw err;
    }
  }

  // Stop FFmpeg stream conversion for a camera
  stopStream(id) {
    const active = this.activeStreams.get(id);
    if (active && active.process) {
      const proc = active.process;
      active.process = null;
      try {
        if (process.platform === "win32" && proc.pid) {
          spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          proc.kill("SIGTERM");
          setTimeout(() => {
            try { proc.kill("SIGKILL"); } catch {}
          }, 400);
        }
      } catch (err) {
        console.warn(`Notice: Error terminating stream for ${id}:`, err.message);
      }
    }

    if (active) {
      active.startedAt = null;
    }

    this.cleanupCameraDir(id);
  }

  // Stop all active streams (called during shutdown)
  stopAllStreams() {
    console.log("[CameraManager] Terminating all active camera streams...");
    for (const [id] of this.activeStreams) {
      this.stopStream(id);
    }
    this.activeStreams.clear();
  }
}
