# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Three-process RTSP camera dashboard with live person-detection overlays and optional face-recognition by name. A browser UI calls a Node backend, which (a) registers RTSP sources with a local MediaMTX server that transcodes them to HLS and (b) spawns a Python YOLO worker per stream that posts detection boxes back through Socket.IO.

## Running the stack

`start.bat` from the repo root launches all three processes in separate windows. Manual equivalents:

- **MediaMTX** — `cd mediamtx && ./mediamtx.exe` (must start first; backend POSTs to its API on boot of each camera).
- **Backend** — `cd backend && npm start` (or `npm run dev` for nodemon). Listens on `:3000`.
- **Frontend** — `cd frontend && python -m http.server 8080`. Static files only; no build step.

Python deps for the AI worker (`face-ai/detect.py`): `ultralytics`, `opencv-python`, and optionally `face_recognition` (for name matching; worker runs without it but skips identification). The worker tries `yolov8n-face.pt` first and falls back to `yolov8n.pt`; if neither file is present, ultralytics auto-downloads `yolov8n.pt` from its hub on first run. When the COCO model is used, only class 0 (`person`) is emitted.

There is no test suite (`npm test` is a stub). `TESTING.md` is a manual verification checklist with public RTSP URLs for smoke testing.

## Architecture

### Data flow for a single camera

1. User posts `{ rtspUrl, cameraName }` to `POST /add-camera` ([backend/server.js:76](backend/server.js#L76)).
2. Backend generates a `streamId` (UUID) and a MediaMTX `pathName = camera_<streamId>`, then calls `POST http://localhost:9997/v3/config/paths/add/<pathName>` with `sourceOnDemand: false` and `rtspTransport: tcp`. **`sourceOnDemand` is deliberately false so the AI worker always has a stream to pull** — changing it will break detection when no browser is watching.
3. Backend spawns `python face-ai/detect.py <rtspUrl> <streamId>` ([backend/server.js:31](backend/server.js#L31)). The worker talks directly to the original RTSP source, not through MediaMTX.
4. Backend returns `hlsUrl = http://localhost:8888/<pathName>/`; the frontend appends `index.m3u8` and plays it with hls.js ([frontend/app.js:115](frontend/app.js#L115)).
5. The Python worker prints one JSON envelope per processed frame to stdout (`{type: "detections", streamId, detections: [...]}`); the backend parses each line and broadcasts `face_detections` over Socket.IO. The event name is kept as `face_detections` even though the payload is now persons/faces — renaming it would break all listeners. The frontend draws boxes onto a `<canvas>` overlaid on the `<video>`. Non-`detections` envelopes (`warning`, `error`) are logged server-side, not forwarded.

### Coordinate contract between worker and frontend

Each detection is `{x, y, w, h, confidence, label, name}` where `x/y/w/h` are **relative** (0..1 of the source frame), `label` is `"person"` or `"face"` depending on which YOLO weights loaded, and `name` is the matched enrollment name or `null`. The frontend multiplies the relative coords by `canvas.width/height`, which is sized to the rendered `<video>`. If you change one side of this contract you must change the other — do not switch to absolute pixels on just one side.

### Per-stream state

Two parallel Maps keyed by `streamId`: `activeStreams` (camera metadata) and `aiProcesses` (child process handles). Both are **in-memory only** — restarting the backend drops all cameras, but MediaMTX keeps the paths it was told to add, so a restart can leave orphaned paths in `mediamtx` that the backend no longer knows about.

Removing a camera (`DELETE /camera/:id`) must both `process.kill()` the Python worker and call MediaMTX's `config/paths/remove` — skipping either leaks resources.

### Frame throttling

The worker processes every 3rd frame (`FRAME_SKIP = 3` in `face-ai/detect.py`) and reconnects on read failure with a 2s backoff. The browser canvas auto-clears 1s after the last detection, so if you slow the worker further, boxes will flicker.

### Enrollment pipeline

Enrollment images are stored at `face-ai/enrollments/<name>.{jpg,png}`. The backend's `/enroll`, `/enrollments`, `/enrollment/:name` routes write/read this directory directly; names are sanitized to `[a-zA-Z0-9 _-]` + underscores. After every write, the backend bumps the directory's mtime. Each worker polls that mtime per frame and re-computes embeddings when it changes — this is how enrollments hot-reload without restarting detectors.

Name matching only runs when (a) `face_recognition` is importable and (b) at least one enrollment exists. When the COCO model is loaded, the worker searches only the upper ~50% of each person box for a face before embedding — this is the cost-control knob; widening it roughly linearly increases CPU.

## MediaMTX configuration

[mediamtx/mediamtx.yml](mediamtx/mediamtx.yml) exposes: API on `127.0.0.1:9997`, HLS on `:8888` (fmp4, 1s segments, CORS `*`). Paths are added dynamically via the API — the `all_others: source: publisher` entry is just the fallback for anything not registered by the backend.
