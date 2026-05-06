const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : `${window.location.protocol}//${window.location.hostname}:3000`;

const socket = io(API);
const grid = document.getElementById('grid');
const cameras = new Map();

const DETECTION_SYNC_DELAY = 1200; // ms to wait for HLS buffer to catch up

socket.on('face_detections', ({ streamId, detections }) => {
  setTimeout(() => {
    const cam = cameras.get(streamId);
    if (!cam) return;
    cam.lastDetections = detections;
    cam.lastUpdate = Date.now();
    drawDetections(cam);
  }, DETECTION_SYNC_DELAY);
});

socket.on('incident_detections', ({ streamId, incidents }) => {
  setTimeout(() => {
    const cam = cameras.get(streamId);
    if (!cam) return;
    cam.lastIncidents = incidents;
    cam.lastIncidentUpdate = Date.now();
    drawDetections(cam);
  }, DETECTION_SYNC_DELAY);
});

function makeTile(streamId, cameraName, rawHlsUrl) {
  // If we are on a remote server, we need to point to that server's port 8888, not localhost
  const hlsUrl = (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
    ? rawHlsUrl.replace('localhost', window.location.hostname)
    : rawHlsUrl;

  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.innerHTML = `
    <div class="title">
      <span>${cameraName}</span>
      <button class="remove" title="Remove Tracking">×</button>
    </div>
    <div class="video-wrap">
      <video autoplay muted playsinline></video>
      <canvas></canvas>
    </div>
    <div class="stats">LOG: SYNCHRONIZING_STREAM...</div>
  `;
  grid.appendChild(tile);

  const video = tile.querySelector('video');
  const canvas = tile.querySelector('canvas');
  const stats = tile.querySelector('.stats');

  const cam = {
    streamId, cameraName, tile, video, canvas, stats,
    lastDetections: [], lastUpdate: 0,
    lastIncidents: [], lastIncidentUpdate: 0,
  };
  cameras.set(streamId, cam);

  tile.querySelector('.remove').addEventListener('click', () => removeCamera(streamId));

  const src = hlsUrl + 'index.m3u8';
  if (window.Hls && Hls.isSupported()) {
    const hls = new Hls({
      lowLatencyMode: true,
      enableWorker: true,
      backBufferLength: 0,
      maxBufferLength: 4,
      maxMaxBufferLength: 8,
      liveSyncDuration: 0.5,
      liveMaxLatencyDuration: 2,
      liveDurationInfinity: true,
      maxLiveSyncPlaybackRate: 2.0,
      manifestLoadingMaxRetry: 10,
    });
    hls.loadSource(src);
    hls.attachMedia(video);
    cam.hls = hls;

    // ── Auto-recovery: handle network/media errors ──────────
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        console.warn(`[${cameraName}] Network error — retrying`);
        setTimeout(() => hls.startLoad(), 1000);
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        console.warn(`[${cameraName}] Media error — recovering`);
        hls.recoverMediaError();
      } else {
        console.warn(`[${cameraName}] Fatal error — reloading source`);
        setTimeout(() => { hls.loadSource(src); hls.startLoad(); }, 2000);
      }
    });

    // ── Stall watchdog: jump to live edge if video freezes ──
    let lastTime = 0;
    let stalledFor = 0;
    cam.stallWatchdog = setInterval(() => {
      if (video.paused || video.ended || !video.src) return;
      if (video.currentTime === lastTime) {
        stalledFor += 1;
        if (stalledFor >= 4) {  // stalled for ~4s
          console.warn(`[${cameraName}] Stall detected — jumping to live edge`);
          const levels = hls.levels;
          if (hls.liveSyncPosition != null) {
            video.currentTime = hls.liveSyncPosition;
          }
          video.play().catch(() => {});
          stalledFor = 0;
        }
      } else {
        stalledFor = 0;
        lastTime = video.currentTime;
      }
    }, 1000);

  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
  }

  video.addEventListener('loadedmetadata', () => resizeCanvas(cam));
  window.addEventListener('resize', () => resizeCanvas(cam));

  cam.clearTimer = setInterval(() => {
    const now = Date.now();
    let changed = false;
    if (now - cam.lastUpdate > 1000 && cam.lastDetections.length) {
      cam.lastDetections = [];
      changed = true;
    }
    if (now - cam.lastIncidentUpdate > 2000 && cam.lastIncidents.length) {
      cam.lastIncidents = [];
      changed = true;
    }
    if (changed) drawDetections(cam);
  }, 500);

  return cam;
}

function resizeCanvas(cam) {
  const rect = cam.video.getBoundingClientRect();
  if (!rect.width) return;
  cam.canvas.width = rect.width;
  cam.canvas.height = rect.height;
  drawDetections(cam);
}

function drawDetections(cam) {
  const { canvas, lastDetections, lastIncidents, stats, tile } = cam;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. Draw Regular Detections (Faces, Persons)
  let named = 0;
  for (const d of lastDetections) {
    const x = d.x * canvas.width;
    const y = d.y * canvas.height;
    const w = d.w * canvas.width;
    const h = d.h * canvas.height;

    const color = d.name ? '#00ff88' : (d.label === 'person' ? '#ffaa00' : '#00f2ff');
    ctx.shadowBlur = 10;
    ctx.shadowColor = color;
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);
    ctx.shadowBlur = 0;

    const label = d.name
      ? `ID: ${d.name.toUpperCase()} (${Math.round(d.confidence * 100)}%)`
      : `OBJ: ${d.label.toUpperCase()} ${Math.round(d.confidence * 100)}%`;
    
    ctx.font = 'bold 12px Inter, system-ui, sans-serif';
    const textW = ctx.measureText(label).width + 12;
    ctx.fillStyle = color;
    ctx.fillRect(x, Math.max(0, y - 22), textW, 22);
    ctx.fillStyle = '#000';
    ctx.fillText(label, x + 6, Math.max(16, y - 6));
    if (d.name) named++;
  }

  // 2. Draw Incidents (Fire, Fighting)
  for (const inc of lastIncidents) {
    const [ix1, iy1, ix2, iy2] = inc.box;
    const x = ix1 * canvas.width;
    const y = iy1 * canvas.height;
    const w = (ix2 - ix1) * canvas.width;
    const h = (iy2 - iy1) * canvas.height;

    const color = '#ff0000'; // High alert Red
    ctx.shadowBlur = 20;
    ctx.shadowColor = 'red';
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);
    
    // Alert Banner
    const label = `⚠️ CRITICAL: ${inc.type.toUpperCase()}`;
    ctx.font = 'bold 14px Inter, system-ui, sans-serif';
    const textW = ctx.measureText(label).width + 16;
    ctx.fillStyle = 'red';
    ctx.fillRect(x, Math.max(0, y - 28), textW, 28);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 8, Math.max(20, y - 8));
  }

  // 3. UI State
  const alertCount = lastIncidents.length;
  if (alertCount > 0) {
    tile.classList.add('incident-alert');
    stats.innerHTML = `<span style="color: #ff4444; font-weight: 800; animation: blink 0.5s infinite">🚨 INCIDENT DETECTED: ${lastIncidents[0].type.toUpperCase()}</span>`;
  } else {
    tile.classList.remove('incident-alert');
    stats.textContent = lastDetections.length
      ? `DETECTION_ALERT: ${lastDetections.length} ACTIVE` + (named ? ` | VERIFIED: ${named}` : '')
      : 'MONITORING: NO_TARGETS';
  }
}

async function addCamera({ cameraName, rtspUrl }) {
  const resp = await fetch(`${API}/add-camera`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cameraName, rtspUrl }),
  });
  if (!resp.ok) {
    alert(`Add camera failed: ${await resp.text()}`);
    return;
  }
  const { streamId, hlsUrl } = await resp.json();
  makeTile(streamId, cameraName, hlsUrl);
}

async function removeCamera(streamId) {
  const cam = cameras.get(streamId);
  if (!cam) return;
  await fetch(`${API}/camera/${streamId}`, { method: 'DELETE' });
  if (cam.hls) cam.hls.destroy();
  if (cam.clearTimer) clearInterval(cam.clearTimer);
  if (cam.stallWatchdog) clearInterval(cam.stallWatchdog);
  cam.tile.remove();
  cameras.delete(streamId);
}

document.getElementById('add-camera-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await addCamera({
    cameraName: fd.get('cameraName'),
    rtspUrl: fd.get('rtspUrl'),
  });
  e.target.reset();
});

document.getElementById('enroll-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const file = fd.get('image');
  const name = fd.get('name');
  const imageBase64 = await fileToBase64(file);
  const resp = await fetch(`${API}/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, imageBase64 }),
  });
  if (!resp.ok) {
    alert(`Enrollment failed: ${await resp.text()}`);
    return;
  }
  e.target.reset();
  refreshEnrollments();
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function refreshEnrollments() {
  const ul = document.getElementById('enrollments');
  const list = await (await fetch(`${API}/enrollments`)).json();
  ul.innerHTML = '';
  for (const { name } of list) {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = `${API}/enrollment/${encodeURIComponent(name)}/image`;
    const span = document.createElement('span');
    span.textContent = name;
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.addEventListener('click', async () => {
      await fetch(`${API}/enrollment/${encodeURIComponent(name)}`, { method: 'DELETE' });
      refreshEnrollments();
    });
    li.append(img, span, btn);
    ul.appendChild(li);
  }
}

async function refreshCameras() {
  const list = await (await fetch(`${API}/cameras`)).json();
  for (const { streamId, cameraName, hlsUrl } of list) {
    if (!cameras.has(streamId)) {
      makeTile(streamId, cameraName, hlsUrl);
    }
  }
}

refreshEnrollments();
refreshCameras();
