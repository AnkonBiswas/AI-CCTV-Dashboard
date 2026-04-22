const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const PORT = 3000;
const MEDIAMTX_API = 'http://localhost:9997';
const HLS_BASE = 'http://localhost:8888';
const PYTHON = process.env.PYTHON || 'python';
const DETECTOR = path.join(__dirname, '..', 'face-ai', 'detect.py');
const ENROLLMENT_DIR = path.join(__dirname, '..', 'face-ai', 'enrollments');

fs.mkdirSync(ENROLLMENT_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const activeStreams = new Map();

// ── Single shared AI worker process ──────────────────────────
let masterWorker = null;
let workerBuf = '';

function startMasterWorker() {
  console.log('[AI] Starting master detection worker...');
  masterWorker = spawn(PYTHON, ['-u', DETECTOR], {
    cwd: path.dirname(DETECTOR),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  masterWorker.stdout.on('data', (chunk) => {
    workerBuf += chunk.toString();
    let nl;
    while ((nl = workerBuf.indexOf('\n')) >= 0) {
      const line = workerBuf.slice(0, nl).trim();
      workerBuf = workerBuf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'detections') {
          io.emit('face_detections', { streamId: msg.streamId, detections: msg.detections });
        } else {
          console.log(`[AI] ${msg.type}: ${msg.message || line}`);
        }
      } catch {
        console.log(`[AI] ${line}`);
      }
    }
  });

  masterWorker.stderr.on('data', (d) => {
    const txt = d.toString().trim();
    // Suppress TFLite/XNNPACK noise
    if (!txt.includes('INFO:') && !txt.includes('XNNPACK') && !txt.includes('feedback')) {
      console.error(`[AI stderr] ${txt}`);
    }
  });

  masterWorker.on('exit', (code) => {
    console.log(`[AI] Worker exited (${code}) — restarting in 3s`);
    masterWorker = null;
    // Re-register all active streams after restart
    setTimeout(() => {
      startMasterWorker();
      for (const [streamId, s] of activeStreams) {
        sendWorkerCmd({ cmd: 'add', streamId, rtspUrl: s.rtspUrl });
      }
    }, 3000);
  });
}

function sendWorkerCmd(obj) {
  if (masterWorker && masterWorker.stdin.writable) {
    masterWorker.stdin.write(JSON.stringify(obj) + '\n');
  }
}

startMasterWorker();

// ── Camera routes ─────────────────────────────────────────────
app.post('/add-camera', async (req, res) => {
  const { rtspUrl, cameraName } = req.body || {};
  if (!rtspUrl || !cameraName) {
    return res.status(400).json({ error: 'rtspUrl and cameraName are required' });
  }

  const streamId = uuidv4();
  const pathName = `camera_${streamId}`;

  try {
    await axios.post(`${MEDIAMTX_API}/v3/config/paths/add/${pathName}`, {
      source: rtspUrl,
      sourceOnDemand: false,
      rtspTransport: 'tcp',
    });
  } catch (err) {
    const detail = err.response?.data || err.message;
    return res.status(502).json({ error: `MediaMTX add path failed: ${JSON.stringify(detail)}` });
  }

  const hlsUrl = `${HLS_BASE}/${pathName}/`;
  // Use MediaMTX's local re-stream so the phone only receives ONE connection.
  // MediaMTX → Python is local loopback; Phone → MediaMTX is the only external link.
  const localRtspUrl = `rtsp://localhost:8554/${pathName}`;
  activeStreams.set(streamId, { cameraName, rtspUrl, pathName, hlsUrl });

  // Tell the single worker to process via local MediaMTX RTSP (not the phone directly)
  sendWorkerCmd({ cmd: 'add', streamId, rtspUrl: localRtspUrl });

  res.json({ streamId, cameraName, hlsUrl });
});

app.delete('/camera/:id', async (req, res) => {
  const { id } = req.params;
  const stream = activeStreams.get(id);
  if (!stream) return res.status(404).json({ error: 'stream not found' });

  // Tell worker to stop this stream's thread
  sendWorkerCmd({ cmd: 'remove', streamId: id });

  try {
    await axios.post(`${MEDIAMTX_API}/v3/config/paths/remove/${stream.pathName}`);
  } catch (err) {
    console.warn(`MediaMTX remove failed: ${err.message}`);
  }

  activeStreams.delete(id);
  res.json({ ok: true });
});

app.get('/cameras', (_req, res) => {
  res.json(
    [...activeStreams.entries()].map(([streamId, s]) => ({ streamId, ...s })),
  );
});

// ── Enrollment routes ─────────────────────────────────────────
function sanitizeName(name) {
  return String(name || '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

app.post('/enroll', (req, res) => {
  const { name, imageBase64 } = req.body || {};
  if (!name || !imageBase64) {
    return res.status(400).json({ error: 'name and imageBase64 required' });
  }
  const safe = sanitizeName(name);
  if (!safe) return res.status(400).json({ error: 'invalid name' });

  const m = imageBase64.match(/^data:image\/(\w+);base64,(.*)$/);
  const ext = m ? (m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase()) : 'jpg';
  const data = m ? m[2] : imageBase64;

  // Find next available numbered slot for this person
  let index = 1;
  let filePath;
  while (true) {
    const exists = ['jpg', 'jpeg', 'png'].some((e) =>
      fs.existsSync(path.join(ENROLLMENT_DIR, `${safe}_${index}.${e}`)),
    );
    if (!exists) { filePath = path.join(ENROLLMENT_DIR, `${safe}_${index}.${ext}`); break; }
    index++;
  }

  try {
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
  } catch (err) {
    return res.status(500).json({ error: `save failed: ${err.message}` });
  }

  fs.utimesSync(ENROLLMENT_DIR, new Date(), new Date());
  res.json({ name: safe, index });
});

app.get('/enrollments', (_req, res) => {
  try {
    const files = fs
      .readdirSync(ENROLLMENT_DIR)
      .filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
    res.json(files.map((f) => ({ name: path.parse(f).name, file: f })));
  } catch {
    res.json([]);
  }
});

app.delete('/enrollment/:name', (req, res) => {
  const safe = sanitizeName(req.params.name);
  let removed = 0;
  // Delete all numbered variants: name_1.jpg, name_2.jpg, etc.
  const files = fs.readdirSync(ENROLLMENT_DIR).filter((f) =>
    new RegExp(`^${safe}(_\\d+)?\\.(jpg|jpeg|png)$`, 'i').test(f),
  );
  for (const f of files) {
    fs.unlinkSync(path.join(ENROLLMENT_DIR, f));
    removed++;
  }
  if (removed) fs.utimesSync(ENROLLMENT_DIR, new Date(), new Date());
  res.json({ removed });
});

app.get('/enrollment/:name/image', (req, res) => {
  const safe = sanitizeName(req.params.name);
  // Serve first image found for this name
  for (const ext of ['jpg', 'jpeg', 'png']) {
    const p1 = path.join(ENROLLMENT_DIR, `${safe}_1.${ext}`);
    if (fs.existsSync(p1)) return res.sendFile(p1);
    const p = path.join(ENROLLMENT_DIR, `${safe}.${ext}`);
    if (fs.existsSync(p)) return res.sendFile(p);
  }
  res.status(404).end();
});

// ── Shutdown ──────────────────────────────────────────────────
process.on('SIGINT', () => {
  sendWorkerCmd({ cmd: 'quit' });
  setTimeout(() => {
    if (masterWorker) masterWorker.kill();
    process.exit(0);
  }, 500);
});

server.listen(PORT, () => console.log(`Backend listening on :${PORT}`));
