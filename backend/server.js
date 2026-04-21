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
const aiProcesses = new Map();

function spawnDetector(streamId, rtspUrl) {
  const proc = spawn(PYTHON, ['-u', DETECTOR, rtspUrl, streamId], {
    cwd: path.dirname(DETECTOR),
  });

  let buf = '';
  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'detections') {
          io.emit('face_detections', {
            streamId: msg.streamId,
            detections: msg.detections,
          });
        } else {
          console.log(`[worker ${streamId}] ${msg.type || 'msg'}: ${msg.message || line}`);
        }
      } catch {
        console.log(`[worker ${streamId}] ${line}`);
      }
    }
  });

  proc.stderr.on('data', (d) =>
    console.error(`[worker ${streamId} stderr] ${d.toString().trim()}`),
  );
  proc.on('exit', (code) => {
    console.log(`[worker ${streamId}] exited with ${code}`);
    aiProcesses.delete(streamId);
  });

  return proc;
}

app.post('/add-camera', async (req, res) => {
  const { rtspUrl, cameraName } = req.body || {};
  if (!rtspUrl || !cameraName) {
    return res.status(400).json({ error: 'rtspUrl and cameraName are required' });
  }

  const streamId = uuidv4();
  const pathName = `camera_${streamId}`;

  try {
    // sourceOnDemand: false — worker needs the stream even when no browser is watching.
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
  activeStreams.set(streamId, { cameraName, rtspUrl, pathName, hlsUrl });

  const proc = spawnDetector(streamId, rtspUrl);
  aiProcesses.set(streamId, proc);

  res.json({ streamId, cameraName, hlsUrl });
});

app.delete('/camera/:id', async (req, res) => {
  const { id } = req.params;
  const stream = activeStreams.get(id);
  if (!stream) return res.status(404).json({ error: 'stream not found' });

  const proc = aiProcesses.get(id);
  if (proc) {
    try { proc.kill(); } catch {}
    aiProcesses.delete(id);
  }

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

  for (const e of ['jpg', 'jpeg', 'png']) {
    const p = path.join(ENROLLMENT_DIR, `${safe}.${e}`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const filePath = path.join(ENROLLMENT_DIR, `${safe}.${ext}`);
  try {
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
  } catch (err) {
    return res.status(500).json({ error: `save failed: ${err.message}` });
  }

  fs.utimesSync(ENROLLMENT_DIR, new Date(), new Date());
  res.json({ name: safe });
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
  for (const ext of ['jpg', 'jpeg', 'png']) {
    const p = path.join(ENROLLMENT_DIR, `${safe}.${ext}`);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      removed++;
    }
  }
  if (removed) fs.utimesSync(ENROLLMENT_DIR, new Date(), new Date());
  res.json({ removed });
});

app.get('/enrollment/:name/image', (req, res) => {
  const safe = sanitizeName(req.params.name);
  for (const ext of ['jpg', 'jpeg', 'png']) {
    const p = path.join(ENROLLMENT_DIR, `${safe}.${ext}`);
    if (fs.existsSync(p)) return res.sendFile(p);
  }
  res.status(404).end();
});

process.on('SIGINT', () => {
  for (const proc of aiProcesses.values()) {
    try { proc.kill(); } catch {}
  }
  process.exit(0);
});

server.listen(PORT, () => console.log(`Backend listening on :${PORT}`));
