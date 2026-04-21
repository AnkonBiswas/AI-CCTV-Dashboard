const API = 'http://localhost:3000';
const socket = io(API);
const grid = document.getElementById('grid');
const cameras = new Map();

socket.on('face_detections', ({ streamId, detections }) => {
  const cam = cameras.get(streamId);
  if (!cam) return;
  cam.lastDetections = detections;
  cam.lastUpdate = Date.now();
  drawDetections(cam);
});

function makeTile(streamId, cameraName, hlsUrl) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.innerHTML = `
    <div class="title">
      <span></span>
      <button class="remove" title="Remove">×</button>
    </div>
    <div class="video-wrap">
      <video autoplay muted playsinline></video>
      <canvas></canvas>
    </div>
    <div class="stats">connecting…</div>
  `;
  tile.querySelector('.title span').textContent = cameraName;
  grid.appendChild(tile);

  const video = tile.querySelector('video');
  const canvas = tile.querySelector('canvas');
  const stats = tile.querySelector('.stats');

  const cam = {
    streamId, cameraName, tile, video, canvas, stats,
    lastDetections: [], lastUpdate: 0,
  };
  cameras.set(streamId, cam);

  tile.querySelector('.remove').addEventListener('click', () => removeCamera(streamId));

  const src = hlsUrl + 'index.m3u8';
  if (window.Hls && Hls.isSupported()) {
    const hls = new Hls({ lowLatencyMode: true });
    hls.loadSource(src);
    hls.attachMedia(video);
    cam.hls = hls;
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
  }

  video.addEventListener('loadedmetadata', () => resizeCanvas(cam));
  window.addEventListener('resize', () => resizeCanvas(cam));

  cam.clearTimer = setInterval(() => {
    if (Date.now() - cam.lastUpdate > 1000 && cam.lastDetections.length) {
      cam.lastDetections = [];
      drawDetections(cam);
    }
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
  const { canvas, lastDetections, stats } = cam;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let named = 0;
  for (const d of lastDetections) {
    // Worker emits relative coords in 0..1 of source frame; we multiply by
    // canvas size which tracks the rendered <video> element.
    const x = d.x * canvas.width;
    const y = d.y * canvas.height;
    const w = d.w * canvas.width;
    const h = d.h * canvas.height;

    const color = d.name ? '#00ff88' : '#ffcc00';
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);

    const label = d.name
      ? `${d.name} (${Math.round(d.confidence * 100)}%)`
      : `${d.label} ${Math.round(d.confidence * 100)}%`;
    ctx.font = '14px system-ui, sans-serif';
    const textW = ctx.measureText(label).width + 8;
    ctx.fillStyle = color;
    ctx.fillRect(x, Math.max(0, y - 18), textW, 18);
    ctx.fillStyle = '#111';
    ctx.fillText(label, x + 4, Math.max(12, y - 4));

    if (d.name) named++;
  }
  stats.textContent = lastDetections.length
    ? `${lastDetections.length} detection(s)` + (named ? ` — ${named} identified` : '')
    : 'no detections';
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

refreshEnrollments();
