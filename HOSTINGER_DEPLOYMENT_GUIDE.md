# Production Deployment Guide on Hostinger

This guide explains how to deploy the **Dynamic Multi-Camera RTSP Streaming Hub** and configure public HTTPS access for integration with your **Smart Neckband Portal**.

---

## 🔍 1. Hosting Capability Analysis: Shared Hosting vs. VPS

> [!IMPORTANT]
> **Can this run on Hostinger Shared Web Hosting?**
> **No.** Hostinger Shared Web Hosting (including Single, Premium, Business, and Cloud Startup plans managed via hPanel) **cannot run persistent RTSP-to-HLS transcoding**.
> 
> Here is why:
> 1. **No Root Access:** Shared hosting environments do not allow installing system binaries like `ffmpeg` via `apt` or compiling custom codecs.
> 2. **Process Lifetime Limits:** Shared hosting uses CloudLinux / LiteSpeed process managers that terminate any process exceeding execution limits (typically 60–120 seconds). Live video streaming requires persistent, uninterrupted child processes.
> 3. **RTSP Ports:** Cameras often communicate over ports 554, 7010, or custom RTSP ports which are blocked in shared hosting firewall environments.

### The Recommended Solutions:

#### Recommended Architecture A: Hostinger KVM VPS (All-in-One or Backend Only)
- Deploy the streaming engine on a **Hostinger VPS** (e.g., KVM 1 or KVM 2 running Ubuntu 24.04 / 22.04 LTS).
- **Cost:** Starts at ~$5–$7/month.
- **Capabilities:** Full `root` access, system-level `ffmpeg` installation, persistent Node.js services managed by `PM2`, Nginx reverse proxy, and free automatic Let's Encrypt SSL certificates.

#### Architecture B: Hybrid Deployment
- If your **Smart Neckband Portal** is already hosted on Hostinger Shared Hosting, **keep it there**!
- Deploy this RTSP streaming backend on a Hostinger VPS under a subdomain (e.g. `camera.yourdomain.com`).
- Embed the live camera feeds into your Smart Neckband Portal via HTTPS iframes or the React/JS integration components.

---

## 🛠️ 2. Step-by-Step Hostinger VPS Deployment

### Step 1: Point your Domain / Subdomain in Hostinger DNS
1. Log in to your **Hostinger hPanel**.
2. Go to **Domains** -> select your domain (e.g., `yourdomain.com`) -> **DNS / Nameservers**.
3. Add an **A Record**:
   - **Type:** `A`
   - **Name:** `camera` (creates `camera.yourdomain.com`)
   - **Points to:** Your Hostinger VPS Public IP Address
   - **TTL:** `300` (or default)

---

### Step 2: Connect to your VPS and Install Dependencies
Connect to your VPS via SSH (using PuTTY or PowerShell):
```bash
ssh root@<YOUR_VPS_IP>
```

Update packages and install **FFmpeg**, **Node.js (v20 LTS)**, **Nginx**, and **PM2**:

```bash
# 1. Update system packages
sudo apt update && sudo apt upgrade -y

# 2. Install FFmpeg, Git, and build tools
sudo apt install -y ffmpeg git curl ufw nginx

# 3. Verify FFmpeg installation
ffmpeg -version

# 4. Install Node.js 20.x LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 5. Install PM2 process manager globally
sudo npm install -g pm2
```

---

### Step 3: Upload and Configure the Streaming Application

Create the application directory on the VPS:
```bash
mkdir -p /var/www/camera-streamer
cd /var/www/camera-streamer
```

Upload your project files (via Git or SFTP) so that `server/` and `client/` are located at `/var/www/camera-streamer`.

#### Configure the Server Environment:
```bash
cd /var/www/camera-streamer/server
npm install --production

# Create production .env
cp .env.example .env
nano .env
```

Set your production environment variables:
```env
PORT=4000
FFMPEG_PATH=ffmpeg
VIDEO_CODEC=libx264
HLS_SEGMENT_SECONDS=2
HLS_LIST_SIZE=5

# Public domain with HTTPS:
PUBLIC_URL=https://camera.yourdomain.com

# Optional: Set an Admin Secret Key to protect camera add/delete APIs
ADMIN_API_KEY=your_secure_random_key_here
```
*(Press `Ctrl + O` then `Enter` to save, `Ctrl + X` to exit).*

---

### Step 4: Build the Frontend Client

```bash
cd /var/www/camera-streamer/client
npm install
npm run build
```
This generates the optimized static production files inside `/var/www/camera-streamer/client/dist`.

---

### Step 5: Start the Backend with PM2 (Persistent 24/7 Execution)

```bash
cd /var/www/camera-streamer/server

# Start the Node.js server with PM2
pm2 start index.js --name "camera-streaming-hub"

# Save PM2 process list so it restarts automatically on server reboot
pm2 save
pm2 startup
```

Check server status:
```bash
pm2 status
pm2 logs camera-streaming-hub --lines 20
```

---

### Step 6: Configure Nginx as a Reverse Proxy with SSL

Create an Nginx server block for your streaming subdomain:
```bash
sudo nano /etc/nginx/sites-available/camera.yourdomain.com
```

Paste the following production Nginx configuration:

```nginx
server {
    listen 80;
    server_name camera.yourdomain.com;

    # Client Web Dashboard (Static React Build)
    location / {
        root /var/www/camera-streamer/client/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # API Endpoints
    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Standalone Embed Player for Smart Neckband Portal
    location /embed/ {
        proxy_pass http://127.0.0.1:4000/embed/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Widget Script
    location /widget.js {
        proxy_pass http://127.0.0.1:4000/widget.js;
        proxy_set_header Host $host;
    }

    # Live HLS Streams (.m3u8 playlists and .ts segments)
    location /streams/ {
        proxy_pass http://127.0.0.1:4000/streams/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;

        # Mandatory zero-cache and CORS headers for HLS players in external portals
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
        add_header Access-Control-Allow-Headers "*" always;
    }
}
```

Enable the site and verify syntax:
```bash
sudo ln -s /etc/nginx/sites-available/camera.yourdomain.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

### Step 7: Install Free HTTPS SSL Certificate (Certbot / Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx

# Obtain and install SSL certificate automatically
sudo certbot --nginx -d camera.yourdomain.com
```

Select `Redirect HTTP to HTTPS` when prompted. Certbot will automatically renew your certificates.

---

### Step 8: Configure Firewall

```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

---

## 🎯 Verification & Public Access

Once completed, you have a fully functional, public HTTPS streaming hub:

1. **Camera Dashboard:** Open `https://camera.yourdomain.com` in your browser.
2. **REST API:** `https://camera.yourdomain.com/api/cameras`
3. **Embed Player:** `https://camera.yourdomain.com/embed/cam-01`
4. **HLS Stream:** `https://camera.yourdomain.com/streams/cam-01/index.m3u8`

You can now drop the embed player or stream URL into your **Smart Neckband Portal** with zero CORS or protocol conflicts!
