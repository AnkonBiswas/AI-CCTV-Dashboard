const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : `${window.location.protocol}//${window.location.hostname}:3000`;

const WEBRTC_BASE = (() => {
  const h = window.location.hostname;
  return (h === 'localhost' || h === '127.0.0.1')
    ? 'http://localhost:8889'
    : `${window.location.protocol}//${h}:8889`;
})();

// ── Auth state ───────────────────────────────────────────
const TOKEN_KEY = 'cctv_token';
let token = localStorage.getItem(TOKEN_KEY);
let socket = null;
let authMode = 'login';

function authedFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, { ...opts, headers }).then(async (r) => {
    if (r.status === 401) { logout(); throw new Error('unauthorized'); }
    return r;
  });
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  token = null;
  if (socket) { socket.disconnect(); socket = null; }
  document.getElementById('app').style.display = 'none';
  showLogin();
}

function showLogin()  { document.getElementById('login-overlay').style.display = 'flex'; }
function hideLogin()  { document.getElementById('login-overlay').style.display = 'none'; }

function decodeJwt(t) {
  try { return JSON.parse(atob(t.split('.')[1])); } catch { return {}; }
}

function setUserChip() {
  const { username = 'user' } = decodeJwt(token);
  document.getElementById('user-name').textContent = username;
  document.getElementById('user-avatar').textContent = (username[0] || '?').toUpperCase();
}

// ── Cameras (live, in-memory) ────────────────────────────
const cameras = new Map(); // streamId -> { tile/video/canvas/etc., status }
const grid = document.getElementById('grid');

const DETECTION_SYNC_DELAY = 1200;

const DETECTION_COLORS = {
  recognized: '#10b981',
  face:       '#3b82f6',
  person:     '#f59e0b',
  incident:   '#ef4444',
};

function fmtTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fmtTimestamp(iso) {
  const d = iso ? new Date(iso) : new Date();
  const date = d.toISOString().slice(0, 10);
  const time = d.toLocaleTimeString([], { hour12: true });
  return `${date} ${time}`;
}

function fmtBytes(n) {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

// ── Socket lifecycle ─────────────────────────────────────
function connectSocket() {
  socket = io(API, { auth: { token } });

  socket.on('connect_error', (err) => {
    if (err && /unauthorized/i.test(err.message || '')) logout();
  });

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

  socket.on('incident_logged', (row) => {
    prependEvent(row);
    prependAlert(row);
    bumpBadge('bell-badge');
    bumpBadge('nav-events-badge');
  });

  socket.on('agent_status', ({ message }) => {
    const modal = document.getElementById('agent-modal');
    if (modal && modal.style.display === 'flex') {
      const desc = modal.querySelector('.modal-desc');
      if (desc) desc.textContent = message;
    }
  });
}

// ── Camera tile ──────────────────────────────────────────
function makeTile(streamId, cameraName, rawHlsUrl) {
  let hlsUrl = rawHlsUrl;
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    hlsUrl = hlsUrl.replace('localhost', window.location.hostname).replace('127.0.0.1', window.location.hostname);
  }

  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.innerHTML = `
    <div class="tile-head">
      <span class="tile-name"></span>
      <span class="tile-status connecting">
        <span class="dot"></span>
        <span class="status-label">Connecting</span>
        <span class="tile-latency" title="Latency behind live"></span>
      </span>
      <button class="tile-more" title="Camera options"><svg><use href="#i-more-vert"/></svg></button>
    </div>
    <div class="video-wrap">
      <video autoplay muted playsinline crossorigin="anonymous"></video>
      <canvas></canvas>
      <div class="tile-timestamp">—</div>
      <div class="tile-controls">
        <button class="rec" title="Recording"><svg><use href="#i-record"/></svg></button>
        <button class="screenshot" title="Screenshot"><svg><use href="#i-screenshot"/></svg></button>
        <button class="fullscreen" title="Fullscreen"><svg><use href="#i-fullscreen"/></svg></button>
      </div>
    </div>
  `;
  tile.querySelector('.tile-name').textContent = cameraName;
  grid.appendChild(tile);

  const video = tile.querySelector('video');
  const canvas = tile.querySelector('canvas');
  const statusPill = tile.querySelector('.tile-status');
  const statusLabel = tile.querySelector('.status-label');
  const latencyEl = tile.querySelector('.tile-latency');
  const tsEl = tile.querySelector('.tile-timestamp');

  const cam = {
    streamId, cameraName, tile, video, canvas, statusPill, statusLabel, latencyEl, tsEl,
    hlsUrl, transport: null,
    state: 'connecting',
    lastDetections: [], lastUpdate: 0,
    lastIncidents: [], lastIncidentUpdate: 0,
  };
  cameras.set(streamId, cam);

  video.addEventListener('playing', () => setTileStatus(cam, 'live'));
  video.addEventListener('waiting', () => setTileStatus(cam, 'connecting'));
  video.addEventListener('error',   () => setTileStatus(cam, 'offline'));

  tile.querySelector('.tile-more').addEventListener('click', (e) => openTileMenu(streamId, e.currentTarget));
  tile.querySelector('.fullscreen').addEventListener('click', () => fullscreenTile(streamId));
  tile.querySelector('.screenshot').addEventListener('click', () => screenshotTile(streamId));

  // Choose transport: WebRTC first, HLS fallback. Stored on cam so the
  // reconnect/ICE handlers can re-trigger startStream without re-deriving them.
  const pathName = (rawHlsUrl.match(/\/([^/]+)\/?$/) || [])[1];
  cam.pathName = pathName;
  startStream(cam, hlsUrl, pathName);

  video.addEventListener('loadedmetadata', () => resizeCanvas(cam));
  video.addEventListener('playing',        () => resizeCanvas(cam));
  window.addEventListener('resize',         () => resizeCanvas(cam));
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => resizeCanvas(cam));
    ro.observe(video);
    cam.resizeObserver = ro;
  }

  cam.tsTimer = setInterval(() => { tsEl.textContent = fmtTimestamp(); }, 1000);

  cam.latencyTimer = setInterval(() => updateLatency(cam), 1000);
  updateLatency(cam);

  cam.clearTimer = setInterval(() => {
    const now = Date.now();
    let changed = false;
    if (now - cam.lastUpdate > 1000 && cam.lastDetections.length) {
      cam.lastDetections = []; changed = true;
    }
    if (now - cam.lastIncidentUpdate > 2000 && cam.lastIncidents.length) {
      cam.lastIncidents = []; changed = true;
    }
    if (changed) drawDetections(cam);
  }, 500);

  refreshCameraStatus();
  return cam;
}

// ── Stream transport: WebRTC primary, HLS fallback, with retry/upgrade ─
const RECONNECT_DELAY_MS = 5000;  // when both transports fail, retry whole flow this often
const PROMOTE_DELAY_MS   = 8000;  // while on HLS, retry WebRTC this often (free upgrade if it works)

async function probeManifest(hlsUrl) {
  try {
    const r = await fetch(hlsUrl + 'index.m3u8', { method: 'HEAD', cache: 'no-store' });
    return r.ok;
  } catch { return false; }
}

function teardownTransports(cam) {
  teardownWebRTC(cam);
  if (cam.hls) { try { cam.hls.destroy(); } catch {} cam.hls = null; }
  if (cam.stallWatchdog) { clearInterval(cam.stallWatchdog); cam.stallWatchdog = null; }
}

function clearReconnectTimers(cam) {
  if (cam.reconnectTimer) { clearTimeout(cam.reconnectTimer); cam.reconnectTimer = null; }
  if (cam.promoteTimer)   { clearTimeout(cam.promoteTimer);   cam.promoteTimer   = null; }
}

function scheduleReconnect(cam, hlsUrl, pathName, delay = RECONNECT_DELAY_MS) {
  if (cam.removed) return;
  clearTimeout(cam.reconnectTimer);
  cam.reconnectTimer = setTimeout(() => startStream(cam, hlsUrl, pathName), delay);
}

function schedulePromote(cam, hlsUrl, pathName) {
  if (cam.removed) return;
  clearTimeout(cam.promoteTimer);
  cam.promoteTimer = setTimeout(async () => {
    if (cam.removed || cam.transport !== 'hls') return;
    try {
      // Probe WebRTC silently; on success, srcObject takes over and we kill HLS.
      await startWebRTC(cam, pathName);
      if (cam.hls) { try { cam.hls.destroy(); } catch {} cam.hls = null; }
      if (cam.stallWatchdog) { clearInterval(cam.stallWatchdog); cam.stallWatchdog = null; }
      cam.transport = 'webrtc';
      console.log(`[${cam.cameraName}] upgraded HLS → WebRTC`);
    } catch {
      teardownWebRTC(cam);
      schedulePromote(cam, hlsUrl, pathName);
    }
  }, PROMOTE_DELAY_MS);
}

async function startStream(cam, hlsUrl, pathName) {
  if (cam.removed) return;
  clearReconnectTimers(cam);
  teardownTransports(cam);
  cam.transport = null;

  // 1. WebRTC
  if (window.RTCPeerConnection && pathName) {
    try {
      await startWebRTC(cam, pathName);
      cam.transport = 'webrtc';
      console.log(`[${cam.cameraName}] using WebRTC`);
      return;
    } catch (err) {
      console.warn(`[${cam.cameraName}] WebRTC unavailable (${err.message})`);
      teardownWebRTC(cam);
    }
  }

  // 2. HLS — only attach if the manifest is actually there, to avoid hls.js
  // spinning on 404s when there's no publisher.
  if (await probeManifest(hlsUrl)) {
    startHLS(cam, hlsUrl);
    cam.transport = 'hls';
    console.log(`[${cam.cameraName}] using HLS`);
    schedulePromote(cam, hlsUrl, pathName);
    return;
  }

  // 3. Nothing available — keep retrying quietly.
  console.log(`[${cam.cameraName}] no stream yet; retrying in ${RECONNECT_DELAY_MS / 1000}s`);
  scheduleReconnect(cam, hlsUrl, pathName);
}

async function startWebRTC(cam, pathName) {
  const url = `${WEBRTC_BASE}/${pathName}/whep`;
  // Empty iceServers = host-candidate-only ICE. Works on the same LAN with no
  // internet (same machine or same WiFi). For deployments behind NAT or across
  // the public internet, add a STUN/TURN server here.
  const pc = new RTCPeerConnection({ iceServers: [] });
  cam.pc = pc;

  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });

  const trackPromise = new Promise((resolve) => {
    pc.ontrack = (ev) => {
      if (ev.streams && ev.streams[0]) {
        cam.video.srcObject = ev.streams[0];
        // Minimum jitter buffer — saves ~200-500ms of glass-to-glass latency
        // on a healthy LAN. Browsers may ignore values they consider unsafe.
        try { ev.receiver.playoutDelayHint = 0; } catch {}
        resolve();
      }
    };
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Wait for ICE gathering with a hard cap so failure is fast.
  await new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', onChange);
    setTimeout(resolve, 1500);
  });

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: pc.localDescription.sdp,
  });
  if (!r.ok) throw new Error(`WHEP HTTP ${r.status}`);
  const answer = await r.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });

  // If the connection drops mid-stream, kick the unified retry loop.
  pc.addEventListener('iceconnectionstatechange', () => {
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      console.warn(`[${cam.cameraName}] WebRTC ICE ${pc.iceConnectionState} — reconnecting`);
      scheduleReconnect(cam, cam.hlsUrl, cam.pathName, 1000);
    }
  });

  // Wait until a track actually arrives, otherwise treat as failure.
  await Promise.race([
    trackPromise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('no track within 4s')), 4000)),
  ]);
}

function teardownWebRTC(cam) {
  if (cam.pc) { try { cam.pc.close(); } catch {} cam.pc = null; }
  if (cam.video) cam.video.srcObject = null;
}

function startHLS(cam, hlsUrl) {
  const video = cam.video;
  const src = hlsUrl + 'index.m3u8';
  if (window.Hls && Hls.isSupported()) {
    const hls = new Hls({
      lowLatencyMode: true, enableWorker: true,
      backBufferLength: 0, maxBufferLength: 4, maxMaxBufferLength: 8,
      liveSyncDuration: 0.5, liveMaxLatencyDuration: 2,
      liveDurationInfinity: true, maxLiveSyncPlaybackRate: 2.0,
      manifestLoadingMaxRetry: 10,
    });
    hls.loadSource(src);
    hls.attachMedia(video);
    cam.hls = hls;
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
        return;
      }
      // Network or other fatal: punt to the unified reconnect flow.
      // probeManifest() will gate when we re-attach hls.js, avoiding 404 spam.
      console.warn(`[${cam.cameraName}] HLS fatal (${data.type}); reconnecting`);
      scheduleReconnect(cam, cam.hlsUrl, cam.pathName, 2000);
    });
    let lastT = 0, stalled = 0;
    cam.stallWatchdog = setInterval(() => {
      if (video.paused || video.ended) return;
      if (video.currentTime === lastT) {
        stalled += 1;
        if (stalled >= 4 && hls.liveSyncPosition != null) {
          video.currentTime = hls.liveSyncPosition;
          video.play().catch(() => {});
          stalled = 0;
        }
      } else { stalled = 0; lastT = video.currentTime; }
    }, 1000);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
  }
}

function setTileStatus(cam, state) {
  cam.state = state;
  cam.statusPill.classList.remove('live', 'connecting', 'offline');
  cam.statusPill.classList.add(state);
  cam.statusLabel.textContent = state === 'live' ? 'Live' : state === 'connecting' ? 'Connecting' : 'Offline';
  updateLatency(cam);
  refreshCameraStatus();
}

async function updateLatency(cam) {
  if (!cam.latencyEl) return;
  cam.latencyEl.classList.remove('warn', 'bad');

  if (cam.state !== 'live') {
    cam.latencyEl.textContent = '';
    return;
  }

  if (cam.transport === 'webrtc' && cam.pc) {
    let rtt = null, jitter = null;
    try {
      const stats = await cam.pc.getStats();
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime != null) {
          rtt = report.currentRoundTripTime;
        } else if (report.type === 'inbound-rtp' && report.kind === 'video' && report.jitter != null) {
          jitter = report.jitter;
        }
      });
    } catch { /* ignore */ }
    if (rtt == null) { cam.latencyEl.textContent = 'RTC · —'; return; }
    const ms = Math.round(rtt * 1000);
    cam.latencyEl.textContent = `RTC · ${ms} ms`;
    if (ms > 800) cam.latencyEl.classList.add('bad');
    else if (ms > 300) cam.latencyEl.classList.add('warn');
    return;
  }

  if (cam.transport === 'hls' && cam.hls && typeof cam.hls.latency === 'number' && isFinite(cam.hls.latency)) {
    const s = cam.hls.latency;
    cam.latencyEl.textContent = s < 1 ? `HLS · ${Math.round(s * 1000)} ms` : `HLS · ${s.toFixed(1)} s`;
    if (s > 5) cam.latencyEl.classList.add('bad');
    else if (s > 2) cam.latencyEl.classList.add('warn');
    return;
  }

  cam.latencyEl.textContent = '';
}

function resizeCanvas(cam) {
  const rect = cam.video.getBoundingClientRect();
  if (!rect.width) return;
  cam.canvas.width = rect.width;
  cam.canvas.height = rect.height;
  drawDetections(cam);
}

function drawBox(ctx, x, y, w, h, color) {
  ctx.lineWidth = 1.5; ctx.strokeStyle = color;
  ctx.strokeRect(x, y, w, h);
}
function drawLabel(ctx, x, y, text, color, height = 18) {
  ctx.font = '500 11px Inter, system-ui, sans-serif';
  const padX = 6;
  const tw = ctx.measureText(text).width;
  const ly = Math.max(0, y - height);
  ctx.fillStyle = color;
  ctx.fillRect(x, ly, tw + padX * 2, height);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, ly + height / 2);
}
function drawDetections(cam) {
  const { canvas, lastDetections, lastIncidents, tile } = cam;
  // Self-heal: if the canvas hasn't been sized yet (e.g., WebRTC track arrived
  // after our initial sizing pass), size it now before we try to draw.
  if (!canvas.width || !canvas.height) resizeCanvas(cam);
  if (!canvas.width || !canvas.height) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const d of lastDetections) {
    const x = d.x * canvas.width, y = d.y * canvas.height;
    const w = d.w * canvas.width, h = d.h * canvas.height;
    const color = d.name ? DETECTION_COLORS.recognized
      : d.label === 'person' ? DETECTION_COLORS.person : DETECTION_COLORS.face;
    drawBox(ctx, x, y, w, h, color);
    const label = `${d.name || d.label} · ${Math.round(d.confidence * 100)}%`;
    drawLabel(ctx, x, y, label, color);
  }
  for (const inc of lastIncidents) {
    const [x1, y1, x2, y2] = inc.box;
    const x = x1 * canvas.width, y = y1 * canvas.height;
    const w = (x2 - x1) * canvas.width, h = (y2 - y1) * canvas.height;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = DETECTION_COLORS.incident;
    ctx.strokeRect(x, y, w, h);
    drawLabel(ctx, x, y, `${inc.type} · ${Math.round((inc.confidence || 0) * 100)}%`, DETECTION_COLORS.incident, 20);
  }
  tile.classList.toggle('incident-alert', lastIncidents.length > 0);
}

// ── Tile context menu ────────────────────────────────────
const tileMenu = document.getElementById('tile-menu');
let menuStreamId = null;
function openTileMenu(streamId, anchor) {
  menuStreamId = streamId;
  const r = anchor.getBoundingClientRect();
  tileMenu.style.display = 'flex';
  tileMenu.style.top = `${r.bottom + 4}px`;
  tileMenu.style.left = `${Math.max(8, r.right - tileMenu.offsetWidth)}px`;
}
function closeTileMenu() { tileMenu.style.display = 'none'; menuStreamId = null; }
document.addEventListener('click', (e) => {
  if (!tileMenu.contains(e.target) && !e.target.closest('.tile-more')) closeTileMenu();
});
tileMenu.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn || !menuStreamId) return;
  const action = btn.dataset.action;
  const sid = menuStreamId;
  closeTileMenu();
  if (action === 'remove') await removeCamera(sid);
  else if (action === 'screenshot') screenshotTile(sid);
  else if (action === 'fullscreen') fullscreenTile(sid);
});

function fullscreenTile(streamId) {
  const cam = cameras.get(streamId);
  if (!cam) return;
  const wrap = cam.video.parentElement;
  (wrap.requestFullscreen || wrap.webkitRequestFullscreen)?.call(wrap);
}
function screenshotTile(streamId) {
  const cam = cameras.get(streamId);
  if (!cam) return;
  const v = cam.video;
  if (!v.videoWidth || !v.videoHeight) {
    alert('Stream not playing yet — try again once the tile shows Live.');
    return;
  }

  const cnv = document.createElement('canvas');
  cnv.width = v.videoWidth;
  cnv.height = v.videoHeight;
  const ctx = cnv.getContext('2d');

  try {
    ctx.drawImage(v, 0, 0, cnv.width, cnv.height);
    // Layer detection overlays at video resolution so they look right in the export.
    if (cam.canvas.width && cam.canvas.height) {
      ctx.drawImage(cam.canvas, 0, 0, cnv.width, cnv.height);
    }
  } catch (err) {
    console.error('[Screenshot] drawImage failed:', err);
    alert('Could not capture frame: the video is cross-origin tainted. Reload the page and try again — the fix is now live.');
    return;
  }

  // Burn-in caption
  const caption = `${cam.cameraName} · ${fmtTimestamp()}`;
  ctx.font = 'bold 16px Inter, system-ui, sans-serif';
  const padX = 12, padY = 8;
  const textW = ctx.measureText(caption).width;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(8, cnv.height - 36, textW + padX * 2, 28);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(caption, 8 + padX, cnv.height - 36 + 14);

  try {
    cnv.toBlob((blob) => {
      if (!blob) { alert('Screenshot failed.'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cam.cameraName.replace(/\s+/g, '_')}-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }, 'image/png');
  } catch (err) {
    console.error('[Screenshot] toBlob failed:', err);
    alert('Could not export PNG (canvas tainted). Reload the page after the latest update and try again.');
  }
}

async function addCamera({ cameraName, rtspUrl }) {
  const r = await authedFetch(`${API}/add-camera`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cameraName, rtspUrl }),
  });
  if (!r.ok) { alert(`Add camera failed: ${await r.text()}`); return; }
  const { streamId, hlsUrl, streamKey, agentStarted } = await r.json();
  makeTile(streamId, cameraName, hlsUrl);
  showAgentModal(streamKey, rtspUrl, agentStarted);
  refreshCamerasTable();
}

async function removeCamera(streamId) {
  const cam = cameras.get(streamId);
  if (!cam) return;
  cam.removed = true;
  clearReconnectTimers(cam);
  await authedFetch(`${API}/camera/${streamId}`, { method: 'DELETE' });
  teardownTransports(cam);
  if (cam.resizeObserver) { cam.resizeObserver.disconnect(); cam.resizeObserver = null; }
  if (cam.clearTimer) clearInterval(cam.clearTimer);
  if (cam.tsTimer) clearInterval(cam.tsTimer);
  if (cam.latencyTimer) clearInterval(cam.latencyTimer);
  cam.tile.remove();
  cameras.delete(streamId);
  refreshCameraStatus();
  refreshCamerasTable();
}

// ── Camera status donut & legend ─────────────────────────
function refreshCameraStatus() {
  const counts = { live: 0, connecting: 0, offline: 0 };
  for (const cam of cameras.values()) counts[cam.state] = (counts[cam.state] || 0) + 1;
  const total = counts.live + counts.connecting + counts.offline;
  document.getElementById('cam-total').textContent = total;
  document.getElementById('cam-live').textContent = counts.live;
  document.getElementById('cam-connecting').textContent = counts.connecting;
  document.getElementById('cam-offline').textContent = counts.offline;

  document.getElementById('cam-online-label').textContent =
    `${counts.live} ${counts.live === 1 ? 'camera' : 'cameras'} online`;
  document.getElementById('sb-cams-online').textContent = counts.live;
  document.getElementById('sb-cams-total').textContent  = total;

  drawDonut('cam-donut', total === 0
    ? [{ value: 1, color: 'rgba(255,255,255,0.06)' }]
    : [
        { value: counts.live,       color: 'var(--success)' },
        { value: counts.connecting, color: 'var(--warning)' },
        { value: counts.offline,    color: '#3a3a40' },
      ].filter(s => s.value > 0));
}

// ── Donut renderer (segmented) ───────────────────────────
function drawDonut(svgId, segments) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  svg.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  const cx = 50, cy = 50, r = 38, sw = 14;
  // Background ring
  const bg = document.createElementNS(NS, 'circle');
  bg.setAttribute('cx', cx); bg.setAttribute('cy', cy); bg.setAttribute('r', r);
  bg.setAttribute('fill', 'none');
  bg.setAttribute('stroke', 'rgba(255,255,255,0.04)');
  bg.setAttribute('stroke-width', sw);
  svg.appendChild(bg);

  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const c = 2 * Math.PI * r;
  let offset = 0;
  for (const seg of segments) {
    const len = (seg.value / total) * c;
    const arc = document.createElementNS(NS, 'circle');
    arc.setAttribute('cx', cx); arc.setAttribute('cy', cy); arc.setAttribute('r', r);
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke', seg.color);
    arc.setAttribute('stroke-width', sw);
    arc.setAttribute('stroke-dasharray', `${len} ${c - len}`);
    arc.setAttribute('stroke-dashoffset', `${-offset}`);
    arc.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
    svg.appendChild(arc);
    offset += len;
  }
}

// ── Recent events (dashboard card) ───────────────────────
const MAX_EVENTS = 5;
const EVENT_TITLES = {
  fire:   'Fire Detected',
  smoke:  'Smoke Detected',
  face:   'Face Detected',
  person: 'Motion Detected',
};

function eventIconHtml(type) {
  const symId = type === 'fire' || type === 'smoke' ? '#i-fire'
    : type === 'face' ? '#i-users'
    : type === 'person' ? '#i-running'
    : '#i-bell';
  return `<span class="event-icon ${type}"><svg><use href="${symId}"/></svg></span>`;
}

function buildEventRow(row) {
  const li = document.createElement('li');
  li.innerHTML = `
    ${eventIconHtml(row.type)}
    <span class="event-text"></span>
    <span class="event-time"></span>
  `;
  const text = li.querySelector('.event-text');
  const title = document.createElement('span');
  title.textContent = EVENT_TITLES[row.type] || row.type;
  text.appendChild(title);
  if (row.cameraName || row.name) {
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = '· ' + (row.name ? `${row.name} @ ${row.cameraName || ''}` : row.cameraName);
    text.appendChild(sub);
  }
  li.querySelector('.event-time').textContent = fmtTime(row.createdAt);
  return li;
}

function prependEvent(row) {
  const ul = document.getElementById('event-list');
  ul.querySelector('.event-empty')?.remove();
  ul.prepend(buildEventRow(row));
  while (ul.children.length > MAX_EVENTS) ul.removeChild(ul.lastChild);
}

// ── Recent alerts (right rail) ───────────────────────────
const MAX_ALERTS = 4;
function buildAlertRow(row) {
  const li = document.createElement('li');
  li.innerHTML = `
    ${eventIconHtml(row.type)}
    <div class="alert-meta">
      <div class="alert-title"></div>
      <div class="alert-sub"></div>
    </div>
    <div class="alert-time"></div>
  `;
  li.querySelector('.alert-title').textContent = EVENT_TITLES[row.type] || row.type;
  const sub = li.querySelector('.alert-sub');
  sub.textContent = row.name ? `${row.name} · ${row.cameraName || ''}` : (row.cameraName || row.streamId);
  li.querySelector('.alert-time').textContent = fmtTime(row.createdAt);
  return li;
}
function prependAlert(row) {
  const ul = document.getElementById('alerts-list');
  ul.querySelector('.event-empty')?.remove();
  ul.prepend(buildAlertRow(row));
  while (ul.children.length > MAX_ALERTS) ul.removeChild(ul.lastChild);
}

// ── Badges ───────────────────────────────────────────────
function bumpBadge(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const n = (parseInt(el.textContent) || 0) + 1;
  el.textContent = n;
  el.dataset.zero = 'false';
}
function setBadge(id, n) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = n;
  el.dataset.zero = n === 0 ? 'true' : 'false';
}

// ── Cameras table page ───────────────────────────────────
function fmtLatency(s) {
  if (typeof s !== 'number' || !isFinite(s)) return '—';
  return s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(1)} s`;
}

async function refreshCamerasTable() {
  const tbody = document.querySelector('#cameras-table tbody');
  if (!tbody) return;
  const list = await (await authedFetch(`${API}/cameras`)).json();
  tbody.innerHTML = '';
  for (const c of list) {
    const cam = cameras.get(c.streamId);
    const state = cam?.state || 'connecting';
    const latency = cam?.hls?.latency;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td></td>
      <td><code style="color:var(--text-muted);font-size:12px"></code></td>
      <td><span class="status-pill ${state}"><span class="dot"></span><span></span></span></td>
      <td style="font-variant-numeric:tabular-nums"></td>
      <td><button class="row-action">Remove</button></td>
    `;
    tr.children[0].textContent = c.cameraName;
    tr.children[1].querySelector('code').textContent = c.rtspUrl;
    tr.children[2].querySelector('span > span').textContent = state[0].toUpperCase() + state.slice(1);
    tr.children[3].textContent = state === 'live' ? fmtLatency(latency) : '—';
    tr.querySelector('button').addEventListener('click', () => removeCamera(c.streamId));
    tbody.appendChild(tr);
  }
}

// ── Enrollments page ─────────────────────────────────────
async function refreshEnrollments() {
  const ul = document.getElementById('enrollments');
  if (!ul) return;
  const list = await (await authedFetch(`${API}/enrollments`)).json();
  ul.innerHTML = '';
  for (const { name } of list) {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = `${API}/enrollment/${encodeURIComponent(name)}/image?token=${encodeURIComponent(token)}`;
    const span = document.createElement('span');
    span.textContent = name.replace(/_/g, ' ');
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.addEventListener('click', async () => {
      await authedFetch(`${API}/enrollment/${encodeURIComponent(name)}`, { method: 'DELETE' });
      refreshEnrollments();
    });
    li.append(img, span, btn);
    ul.appendChild(li);
  }
}

// ── Events / Alerts page ─────────────────────────────────
async function refreshEventsTable() {
  const tbody = document.querySelector('#events-table tbody');
  if (!tbody) return;
  const list = await (await authedFetch(`${API}/incidents?limit=200`)).json();
  tbody.innerHTML = '';
  for (const row of list) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td></td><td></td><td></td><td></td><td></td>`;
    const typeCell = document.createElement('span');
    typeCell.className = `event-icon ${row.type}`;
    typeCell.style.display = 'inline-grid';
    typeCell.innerHTML = `<svg><use href="${
      row.type === 'fire' || row.type === 'smoke' ? '#i-fire'
      : row.type === 'face' ? '#i-users'
      : '#i-running'
    }"/></svg>`;
    tr.children[0].appendChild(typeCell);
    tr.children[0].appendChild(document.createTextNode(' ' + (EVENT_TITLES[row.type] || row.type)));
    tr.children[1].textContent = row.cameraName || row.streamId;
    tr.children[2].textContent = row.name || '—';
    tr.children[3].textContent = row.confidence != null ? `${Math.round(row.confidence * 100)}%` : '—';
    tr.children[4].textContent = fmtTime(row.createdAt);
    tbody.appendChild(tr);
  }
}

// ── Features page (settings) ─────────────────────────────
function prettyFeatureName(slug) {
  return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function refreshFeatures() {
  const ul = document.getElementById('features-list');
  if (!ul) return;
  const list = await (await authedFetch(`${API}/features`)).json();
  ul.innerHTML = '';
  for (const f of list) {
    const li = document.createElement('li');
    li.className = 'feature-item';
    li.innerHTML = `
      <label class="feature-toggle">
        <span class="feature-name"></span>
        <input type="checkbox" ${f.enabled ? 'checked' : ''}>
        <span class="switch"></span>
      </label>
      <small class="feature-desc"></small>
    `;
    li.querySelector('.feature-name').textContent = prettyFeatureName(f.name);
    li.querySelector('.feature-desc').textContent = f.description || '';
    li.querySelector('input').addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      const r = await authedFetch(`${API}/features/${encodeURIComponent(f.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!r.ok) { e.target.checked = !enabled; alert('Toggle failed'); }
    });
    ul.appendChild(li);
  }
}

// ── Initial-load fillers for events & alerts ─────────────
async function loadInitialEvents() {
  const list = await (await authedFetch(`${API}/incidents?limit=20`)).json();
  const ev = document.getElementById('event-list');
  const al = document.getElementById('alerts-list');
  ev.innerHTML = ''; al.innerHTML = '';
  if (list.length === 0) {
    ev.innerHTML = '<li class="event-empty">No events yet.</li>';
    al.innerHTML = '<li class="event-empty">No alerts yet.</li>';
    setBadge('bell-badge', 0);
    setBadge('nav-events-badge', 0);
    return;
  }
  for (const row of list.slice(0, MAX_EVENTS))  ev.appendChild(buildEventRow(row));
  for (const row of list.slice(0, MAX_ALERTS)) al.appendChild(buildAlertRow(row));
  setBadge('bell-badge', list.length);
  setBadge('nav-events-badge', list.length);
}

// ── Analytics ────────────────────────────────────────────
function setStat(id, value, deltaPct) {
  document.getElementById(id).textContent = value.toLocaleString();
  const d = document.getElementById(`${id}-delta`);
  if (!d) return;
  d.classList.remove('up', 'down', 'flat');
  if (Math.abs(deltaPct) < 0.5) {
    d.classList.add('flat');
    d.textContent = '0%';
  } else if (deltaPct > 0) {
    d.classList.add('up');
    d.textContent = `${deltaPct.toFixed(1)}%`;
  } else {
    d.classList.add('down');
    d.textContent = `${Math.abs(deltaPct).toFixed(1)}%`;
  }
}

async function refreshAnalytics() {
  const period = document.getElementById('analytics-period').value;
  const r = await (await authedFetch(`${API}/analytics?period=${period}`)).json();
  setStat('stat-people',     r.counts.people,     r.deltas.people);
  setStat('stat-recognized', r.counts.recognized, r.deltas.recognized);
  setStat('stat-events',     r.counts.events,     r.deltas.events);
  setStat('stat-alerts',     r.counts.alerts,     r.deltas.alerts);
}

// ── System health ────────────────────────────────────────
async function refreshSystemHealth() {
  let health = null;
  try { health = await (await authedFetch(`${API}/system-health`)).json(); }
  catch { return; }

  const mediamtx = health.mediamtx ? 100 : 0;
  const ai = health.aiWorker ? 100 : 0;
  const storagePct = health.storage ? Math.round((health.storage.used / health.storage.total) * 100) : 0;

  const setBar = (id, pct, severity) => {
    const bar = document.getElementById(`${id}-bar`);
    bar.style.width = `${pct}%`;
    bar.classList.remove('warning', 'danger', 'success');
    bar.classList.add(severity);
    document.getElementById(`${id}-pct`).textContent = `${pct}%`;
  };
  setBar('health-mediamtx', mediamtx, mediamtx === 100 ? 'success' : 'danger');
  setBar('health-ai', ai, ai === 100 ? 'success' : 'danger');
  setBar('health-storage', storagePct,
    storagePct >= 90 ? 'danger' : storagePct >= 75 ? 'warning' : 'success');

  const allUp = mediamtx === 100 && ai === 100 && storagePct < 90;
  const anyDown = mediamtx === 0 || ai === 0;
  const status = document.getElementById('health-status');
  const txt = document.getElementById('health-status-text');
  status.classList.remove('degraded', 'down');
  if (anyDown) { status.classList.add('down'); txt.textContent = 'Service degraded'; }
  else if (!allUp) { status.classList.add('degraded'); txt.textContent = 'Storage near capacity'; }
  else { txt.textContent = 'All systems operational'; }

  // Sidebar status card: storage + (synthetic) CPU from worker presence
  if (health.storage) {
    document.getElementById('sb-storage').textContent =
      `${fmtBytes(health.storage.used)} / ${fmtBytes(health.storage.total)}`;
    const sb = document.getElementById('sb-storage-bar');
    sb.style.width = `${storagePct}%`;
    sb.classList.remove('warning', 'danger', 'success');
    sb.classList.add(storagePct >= 90 ? 'danger' : storagePct >= 75 ? 'warning' : 'success');

    document.getElementById('storage-used').textContent  = fmtBytes(health.storage.used);
    document.getElementById('storage-total').textContent = fmtBytes(health.storage.total);
    document.getElementById('storage-free').textContent  = fmtBytes(health.storage.free);
    document.getElementById('storage-pct').textContent   = `${storagePct}%`;
    drawDonut('storage-donut', [
      { value: health.storage.used, color: storagePct >= 90 ? 'var(--danger)' : storagePct >= 75 ? 'var(--warning)' : 'var(--accent)' },
      { value: health.storage.free, color: '#2a2a30' },
    ]);
  }
  // CPU placeholder (we don't measure host CPU; show worker liveness as a rough proxy)
  const cpuPct = ai === 100 ? 45 : 0;
  document.getElementById('sb-cpu').textContent = `${cpuPct}%`;
  document.getElementById('sb-cpu-bar').style.width = `${cpuPct}%`;
}

// ── Routing (stub-friendly) ──────────────────────────────
const PAGES = {
  dashboard: 'page-dashboard', live: 'page-dashboard',
  cameras:   'page-cameras',
  users:     'page-users',
  events:    'page-events',
  alerts:    'page-events',
  settings:  'page-settings',
};
const PAGE_TITLES = {
  events: 'Events',
  alerts: 'Recent Alerts',
};

function showRoute(route) {
  const target = PAGES[route] || 'page-stub';
  document.querySelectorAll('.page').forEach((p) => { p.style.display = (p.id === target) ? '' : 'none'; });
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.route === route));

  if (target === 'page-stub') {
    document.getElementById('stub-title').textContent = `${route[0].toUpperCase() + route.slice(1)} — coming soon`;
    document.getElementById('stub-desc').textContent  = 'This section is on the roadmap. We\'ll build it out next.';
  }
  if (route === 'cameras')  refreshCamerasTable();
  if (route === 'users')    refreshEnrollments();
  if (route === 'settings') refreshFeatures();
  if (route === 'events' || route === 'alerts') {
    document.getElementById('events-title').textContent = PAGE_TITLES[route];
    refreshEventsTable();
    setBadge('bell-badge', 0);
    setBadge('nav-events-badge', 0);
  }
}

document.querySelectorAll('.nav-item').forEach((n) => {
  n.addEventListener('click', (e) => {
    if (n.classList.contains('disabled')) { e.preventDefault(); return; }
    showRoute(n.dataset.route);
  });
});
document.querySelectorAll('.link[data-route]').forEach((a) => {
  a.addEventListener('click', () => showRoute(a.dataset.route));
});

// ── Modal helpers ────────────────────────────────────────
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
document.querySelectorAll('[data-close]').forEach((b) => {
  b.addEventListener('click', () => closeModal(b.dataset.close));
});
document.querySelectorAll('.modal-overlay').forEach((m) => {
  m.addEventListener('click', (e) => { if (e.target === m) m.style.display = 'none'; });
});

document.getElementById('add-camera-btn')?.addEventListener('click', () => openModal('add-camera-modal'));
document.getElementById('add-camera-btn-2')?.addEventListener('click', () => openModal('add-camera-modal'));
document.getElementById('add-person-btn')?.addEventListener('click', () => openModal('add-person-modal'));

document.getElementById('add-camera-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await addCamera({ cameraName: fd.get('cameraName'), rtspUrl: fd.get('rtspUrl') });
  e.target.reset();
  closeModal('add-camera-modal');
});

document.getElementById('enroll-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const file = fd.get('image');
  const reader = new FileReader();
  reader.onload = async () => {
    const r = await authedFetch(`${API}/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fd.get('name'), imageBase64: reader.result }),
    });
    if (!r.ok) { alert(`Enroll failed: ${await r.text()}`); return; }
    e.target.reset();
    closeModal('add-person-modal');
    refreshEnrollments();
  };
  reader.readAsDataURL(file);
});

// ── Top bar wiring ───────────────────────────────────────
const userMenuBtn = document.getElementById('user-menu-btn');
const userMenu = document.getElementById('user-menu');
userMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (userMenu.style.display === 'flex') {
    userMenu.style.display = 'none';
    return;
  }
  const r = userMenuBtn.getBoundingClientRect();
  userMenu.style.display = 'flex';
  userMenu.style.top = `${r.bottom + 6}px`;
  userMenu.style.left = `${Math.max(8, r.right - 180)}px`;
});
document.addEventListener('click', (e) => {
  if (!userMenu.contains(e.target) && !e.target.closest('#user-menu-btn')) {
    userMenu.style.display = 'none';
  }
});
document.getElementById('logout-btn').addEventListener('click', () => {
  userMenu.style.display = 'none';
  logout();
});
document.getElementById('fullscreen-btn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
});
document.getElementById('bell-btn').addEventListener('click', () => showRoute('alerts'));
document.getElementById('grid-size').addEventListener('change', (e) => {
  grid.classList.remove('grid-1', 'grid-2', 'grid-3', 'grid-4', 'grid-auto');
  grid.classList.add(`grid-${e.target.value}`);
  for (const cam of cameras.values()) resizeCanvas(cam);
});
document.getElementById('analytics-period').addEventListener('change', refreshAnalytics);

// ── Auth tabs ────────────────────────────────────────────
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('auth-heading').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
  document.getElementById('auth-desc').textContent = mode === 'signup'
    ? 'Pick a username and password — your cameras and people stay private to you.'
    : 'Enter your credentials to access the dashboard.';
  document.getElementById('auth-submit').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
  document.querySelector('#auth-form input[name="password"]').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  document.getElementById('login-error').textContent = '';
}
document.querySelectorAll('.auth-tab').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.mode)));

document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  const path = authMode === 'signup' ? '/signup' : '/login';
  try {
    const r = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }),
    });
    if (!r.ok) {
      const { error } = await r.json().catch(() => ({}));
      errEl.textContent = error || (authMode === 'signup' ? 'Sign up failed' : 'Login failed');
      return;
    }
    const data = await r.json();
    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
    e.target.reset();
    bootAuthedUI();
  } catch (err) { errEl.textContent = err.message; }
});

// ── Boot ─────────────────────────────────────────────────
async function bootAuthedUI() {
  hideLogin();
  document.getElementById('app').style.display = '';
  setUserChip();
  connectSocket();

  // Initial pulls
  refreshCameraStatus();
  await Promise.all([
    refreshSystemHealth().catch(() => {}),
    refreshAnalytics().catch(() => {}),
    loadInitialEvents().catch(() => {}),
  ]);

  // Load existing cameras
  const list = await (await authedFetch(`${API}/cameras`)).json();
  for (const { streamId, cameraName, hlsUrl } of list) {
    if (!cameras.has(streamId)) makeTile(streamId, cameraName, hlsUrl);
  }

  // Periodic refreshers
  setInterval(refreshSystemHealth, 15000);
  setInterval(refreshAnalytics, 60000);
}

// ── Agent modal ──────────────────────────────────────────
function showAgentModal(streamKey, rtspUrl, agentStarted = false) {
  const isWindows = navigator.userAgent.includes('Win');
  const ffmpegInstall = isWindows
    ? 'winget install -e --id Gyan.FFmpeg'
    : 'sudo apt install ffmpeg   # Debian/Ubuntu\n# brew install ffmpeg          # macOS';
  document.getElementById('ffmpeg-cmd').textContent = ffmpegInstall;
  document.getElementById('agent-cmd').textContent = `python agent/agent.py ${API} ${streamKey} ${rtspUrl}`;
  const desc = document.querySelector('#agent-modal .modal-desc');
  if (desc) {
    desc.innerHTML = agentStarted
      ? `The system has automatically started a local FFmpeg bridge. <strong>You don't need to do anything</strong> — but here's the manual command if your camera lives on a different machine:`
      : `Your camera is registered. Run <strong>agent.py</strong> on a machine that can reach your camera.`;
  }
  openModal('agent-modal');
}

document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.target);
    navigator.clipboard.writeText(target.textContent).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 1500);
    });
  });
});

if (token) bootAuthedUI();
else showLogin();
