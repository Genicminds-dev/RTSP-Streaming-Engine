import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { CameraManager } from "./cameraManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = express();
const PORT = Number(process.env.PORT || 4000);
const ADMIN_API_KEY = (process.env.ADMIN_API_KEY || "").trim();

const cameraManager = new CameraManager();

// Configure CORS: Allow any origin to consume HLS streams and APIs (essential for Smart Neckband Portal integration)
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"]
}));
app.use(express.json());

// Serve static HLS stream files with zero-cache headers & permissive CORS
const streamsPath = path.join(__dirname, "public", "streams");
app.use("/streams", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
}, express.static(streamsPath, {
  setHeaders(res, filePath) {
    if (filePath.endsWith(".m3u8")) res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    if (filePath.endsWith(".ts")) res.setHeader("Content-Type", "video/mp2t");
  }
}));

// Serve standalone embed player for iframes (Smart Neckband Portal embed)
app.get("/embed/:id", (req, res) => {
  const embedHtmlPath = path.join(__dirname, "public", "embed.html");
  if (fs.existsSync(embedHtmlPath)) {
    res.sendFile(embedHtmlPath);
  } else {
    res.status(404).send("Embed player template not found.");
  }
});

// Serve vanilla JS integration widget for external portals
app.get("/widget.js", (_req, res) => {
  const widgetPath = path.resolve(__dirname, "..", "integration", "smart-neckband-camera-widget.js");
  if (fs.existsSync(widgetPath)) {
    res.setHeader("Content-Type", "application/javascript");
    res.sendFile(widgetPath);
  } else {
    res.status(404).send("// Widget script not found");
  }
});

// Authentication middleware for administrative write operations
function requireAuth(req, res, next) {
  if (!ADMIN_API_KEY) {
    return next(); // If no key is set in .env, operate in open local mode
  }
  const key = req.headers["x-api-key"] || req.query.key;
  if (key === ADMIN_API_KEY) {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized: Invalid or missing x-api-key." });
}

// -------------------------------------------------------------
// REST API Routes for Dynamic Multi-Camera Management
// -------------------------------------------------------------

// System Health Check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "rtsp-camera-server",
    camerasCount: cameraManager.readCameras().length,
    activeStreamsCount: cameraManager.activeStreams.size,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// List all cameras (sanitized: no sensitive RTSP credentials exposed)
app.get("/api/cameras", (req, res) => {
  try {
    const cameras = cameraManager.getAll(req);
    res.json(cameras);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register a new camera
app.post("/api/cameras", requireAuth, (req, res) => {
  try {
    const newCamera = cameraManager.addCamera(req.body);
    const cameraInfo = cameraManager.getById(newCamera.id, req);
    res.status(201).json({
      message: "Camera registered successfully.",
      camera: cameraInfo
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get single camera details
app.get("/api/cameras/:id", (req, res) => {
  const camera = cameraManager.getById(req.params.id, req);
  if (!camera) {
    return res.status(404).json({ error: `Camera '${req.params.id}' not found.` });
  }
  res.json(camera);
});

// Update camera details
app.put("/api/cameras/:id", requireAuth, (req, res) => {
  try {
    cameraManager.updateCamera(req.params.id, req.body);
    const updated = cameraManager.getById(req.params.id, req);
    res.json({ message: "Camera updated successfully.", camera: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a camera and clean up its streams
app.delete("/api/cameras/:id", requireAuth, (req, res) => {
  try {
    cameraManager.deleteCamera(req.params.id);
    res.json({ message: `Camera '${req.params.id}' deleted successfully.` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get stream status for a camera
app.get("/api/cameras/:id/status", (req, res) => {
  const camera = cameraManager.getById(req.params.id, req);
  if (!camera) {
    return res.status(404).json({ error: `Camera '${req.params.id}' not found.` });
  }
  res.json(camera);
});

// Start streaming for a camera
app.post("/api/cameras/:id/start", async (req, res) => {
  try {
    const result = await cameraManager.startStream(req.params.id);
    const camera = cameraManager.getById(req.params.id, req);
    res.json({ ...result, camera });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stop streaming for a camera
app.post("/api/cameras/:id/stop", (req, res) => {
  try {
    cameraManager.stopStream(req.params.id);
    const camera = cameraManager.getById(req.params.id, req);
    res.json({ message: `Stream for camera '${req.params.id}' stopped.`, camera });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start all cameras
app.post("/api/cameras/start-all", async (req, res) => {
  const cameras = cameraManager.readCameras();
  const results = [];
  for (const cam of cameras) {
    try {
      await cameraManager.startStream(cam.id);
      results.push({ id: cam.id, ok: true });
    } catch (err) {
      results.push({ id: cam.id, ok: false, error: err.message });
    }
  }
  res.json({ message: "Start all triggered.", results, cameras: cameraManager.getAll(req) });
});

// Stop all cameras
app.post("/api/cameras/stop-all", (req, res) => {
  cameraManager.stopAllStreams();
  res.json({ message: "All streams stopped.", cameras: cameraManager.getAll(req) });
});

// Backward-compatibility aliases for legacy single-camera calls
app.get("/api/stream/status", (req, res) => {
  const cameras = cameraManager.getAll(req);
  if (cameras.length > 0) {
    return res.json(cameras[0]);
  }
  res.json({ running: false, playlistReady: false, error: "No cameras configured." });
});

app.post("/api/stream/start", async (req, res) => {
  const cameras = cameraManager.readCameras();
  if (cameras.length === 0) {
    return res.status(400).json({ error: "No cameras configured. Register a camera first." });
  }
  try {
    const result = await cameraManager.startStream(cameras[0].id);
    const cam = cameraManager.getById(cameras[0].id, req);
    res.json({ ...result, ...cam });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/stream/stop", (req, res) => {
  const cameras = cameraManager.readCameras();
  if (cameras.length > 0) {
    cameraManager.stopStream(cameras[0].id);
    const cam = cameraManager.getById(cameras[0].id, req);
    return res.json({ message: "Stream stopped.", ...cam });
  }
  res.json({ message: "No active stream to stop." });
});

// -------------------------------------------------------------
// Server Initialization & Graceful Exit
// -------------------------------------------------------------

app.listen(PORT, () => {
  const cameras = cameraManager.readCameras();
  console.log(`====================================================`);
  console.log(` Multi-Camera RTSP Streaming Server Active`);
  console.log(` Port: ${PORT}`);
  console.log(` Registered Cameras: ${cameras.length}`);
  console.log(` Endpoints:`);
  console.log(`   - List Cameras:  GET  http://localhost:${PORT}/api/cameras`);
  console.log(`   - Embed Player:  GET  http://localhost:${PORT}/embed/:cameraId`);
  console.log(`   - HLS Streams:   GET  http://localhost:${PORT}/streams/:cameraId/index.m3u8`);
  console.log(`====================================================`);
});

function handleShutdown() {
  cameraManager.stopAllStreams();
  process.exit(0);
}

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);
process.on("exit", () => cameraManager.stopAllStreams());
process.on("uncaughtException", (err) => {
  console.error("[Fatal] Uncaught exception:", err);
  cameraManager.stopAllStreams();
  process.exit(1);
});
