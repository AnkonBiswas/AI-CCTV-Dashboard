# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Multi-camera RTSP dashboard with live person/face detection, name recognition, and fire/incident overlays. Four cooperating processes:

1. **MediaMTX** — RTSP ingest + HLS re-publishing.
2. **Backend** (Node/Express + Socket.IO) — registers MediaMTX paths, spawns the local push agent and the shared AI worker, fans out detections to browsers.
3. **Local agent** (`agent/agent.py`) — FFmpeg bridge that pulls from a camera's RTSP URL and pushes to MediaMTX's `:8554` ingest. Auto-spawned by the backend for local cameras; can also be run manually on a remote LAN.
4. **Master AI worker** (`face-ai/detect.py`) — a single Python process running MediaPipe face detection, LBPH name recognition, YOLOv8 object detection, and a fire detector across all streams.

## Running the stack

`start.bat` from the repo root launches MediaMTX, backend, and frontend in separate minimized windows. **It first kills any existing `node.exe`, `python.exe`, and `mediamtx.exe`** to avoid port conflicts — be aware if you have unrelated Python/Node processes running.

Manual equivalents:

- **MediaMTX** — `cd mediamtx && ./mediamtx.exe` (must start first; backend POSTs to its API at boot of each camera).
- **Backend** — `cd backend && npm start` (or `npm run dev` for nodemon). Listens on `:3000`. Spawns the master AI worker on startup.
- **Frontend** — `cd frontend && python -m http.server 8080`. Static files only; no build step.

Python deps for the AI worker: `ultralytics`, `opencv-python` (with `opencv-contrib-python` for `cv2.face.LBPHFaceRecognizer_create`), `mediapipe`, `numpy`. The agent (`agent/agent.py`) needs FFmpeg on PATH; on Windows it auto-downloads a portable `ffmpeg.exe` into `agent/` if missing.

`PYTHON` env var overrides the interpreter the backend spawns for both `detect.py` and `agent.py` (defaults to `python`).

There is no test suite (`npm test` is a stub). `TESTING.md` is currently empty.

## Architecture

### Data flow for one camera

1. Browser POSTs `{ rtspUrl, cameraName }` to `POST /add-camera` ([backend/server.js:95](backend/server.js#L95)).
2. Backend mints `streamId` (UUID) and `pathName = camera_<streamId-with-underscores>`, then calls `POST http://127.0.0.1:9997/v3/config/paths/add/<pathName>` with an empty body — registering a publisher path with no `source`. **Paths are publisher endpoints, not pull sources.** Anything that pushes to `rtsp://127.0.0.1:8554/<pathName>` becomes the stream.
3. Backend tells the master AI worker over stdin: `{cmd:"add", streamId, rtspUrl: "rtsp://127.0.0.1:8554/<pathName>"}` ([backend/server.js:123](backend/server.js#L123)). **The worker reads MediaMTX's loopback re-stream, not the original camera URL.** This is what gives the worker low-latency, TCP-stable input even when the camera is across a flaky LAN.
4. Backend spawns `python agent/agent.py http://127.0.0.1:3000 <pathName> <rtspUrl>` ([backend/server.js:129](backend/server.js#L129)). The agent polls `GET /streams/<pathName>`, then runs `ffmpeg -rtsp_transport tcp -i <rtspUrl> -c copy -f rtsp <push-url>` to bridge into MediaMTX. It auto-reconnects with a 5s backoff.
5. Backend returns `hlsUrl = http://127.0.0.1:8888/<pathName>/`. Frontend appends `index.m3u8` and plays it via hls.js.
6. Master worker emits one JSON line per processed frame on stdout: `{type:"detections", streamId, detections:[…], incidents:[…]}`. Backend parses each line and forwards via Socket.IO as **two separate events**: `face_detections` (persons + faces) and `incident_detections` (only when `incidents` is non-empty). Non-`detections` envelopes (`info`, `warning`, `error`, `ready`) are logged server-side, not forwarded. The event name `face_detections` is kept even though the payload now mixes persons and faces — renaming would break the frontend listener.

### Single shared AI worker

[backend/server.js:35](backend/server.js#L35) spawns ONE `detect.py` process at startup and pipes commands over stdin. The worker spawns one thread per `streamId` ([face-ai/detect.py:113](face-ai/detect.py#L113)) — adding a camera does not fork a new process. The stdin command protocol is `{cmd:"add"|"remove"|"quit", streamId, rtspUrl?}`.

If the worker exits, the backend re-spawns it after 3s and replays `add` commands for every entry in `activeStreams` ([backend/server.js:73](backend/server.js#L73)). Don't add per-process state in `detect.py` that can't survive an `add` replay.

Models share locks to stay thread-safe across stream threads: `face_detector_lock`, `yolo_lock`, `recognizer_lock`. If you add a model, give it its own lock — don't reuse an existing one.

### Per-stream state on the backend

Two Maps keyed by `streamId`:
- `activeStreams` — camera metadata (`cameraName`, `rtspUrl`, `pathName`, `hlsUrl`).
- `activeAgents` — child process handles for the auto-spawned `agent.py` instances.

Both are **in-memory only**. Restarting the backend drops both maps but the agents and MediaMTX paths persist as orphans until manually killed (or until `start.bat` blows them away). `DELETE /camera/:id` must do all four: `sendWorkerCmd({cmd:"remove"})`, `agentProc.kill()`, `POST /v3/config/paths/remove/<pathName>` to MediaMTX, and `activeStreams.delete()`. Skipping any one leaks resources.

### Coordinate contract between worker and frontend

Each detection is `{x, y, w, h, confidence, label, name?}` where `x/y/w/h` are **relative (0..1)** of the (downscaled) source frame. `label` is `"person"` (from YOLO) or `"face"` (from MediaPipe). `name` is the LBPH-matched enrollment name or `null`. Incidents are `{type:"fire", confidence, box:[x1,y1,x2,y2]}` — note `box` is **two corners**, not `xywh`. Frontend multiplies by `canvas.width/height` ([frontend/app.js:177](frontend/app.js#L177)). If you change one side of this contract, change the other.

### Frame throttling and downscale

`FRAME_SKIP = 5` ([face-ai/detect.py:13](face-ai/detect.py#L13)) — every 5th frame is processed. Each processed frame is then downscaled to 0.5× before face detection and YOLO. The fire model (when loaded) runs on the *full-size* frame. The browser canvas auto-clears 1s after the last detection event, so if you slow the worker further, boxes will flicker.

### Models and where they come from

- **MediaPipe face detector** — `face-ai/blaze_face_short_range.tflite`, auto-downloaded from Google Storage on first run if missing.
- **YOLOv8 base** — `face-ai/yolov8n.pt`, must be present (ultralytics will auto-download on first instantiation if absent).
- **Fire model** — `face-ai/fire_model.pt`, optional. Loaded only if the file exists AND is >1MB (the >1MB check guards against a corrupt/empty placeholder). When absent, fire detection falls back to an HSV color heuristic in `stream_worker` ([face-ai/detect.py:222](face-ai/detect.py#L222)).
- **LBPH face recognizer** — `cv2.face.LBPHFaceRecognizer_create()`. Requires `opencv-contrib-python`. **Not** `dlib` / `face_recognition` (different stack from older revisions).

YOLO person boxes are filtered: `confidence < 0.6` and `bw*bh < 0.05` (relative area) are dropped to suppress false positives on hands and tiny figures. These thresholds are tuned for typical CCTV framing — relaxing them resurfaces noise.

### Enrollment pipeline

Images live at `face-ai/enrollments/<name>_<index>.{jpg,jpeg,png}` (multiple shots per person, numbered). The backend's `/enroll` route writes the next available numbered slot and bumps the directory mtime. Each stream worker watches `os.path.getmtime(ENROLLMENT_DIR)` per frame and calls `train_recognizer()` when it changes ([face-ai/detect.py:147](face-ai/detect.py#L147)) — this is how enrollments hot-reload without restarting anything. Multiple files for the same `name` (the `_<digits>` suffix is stripped to derive the label) all train into one LBPH class.

Recognition match: `recognizer.predict(crop)` returns `(label, dist)`; we accept the match when `dist < RECOGNITION_THRESHOLD` (115). LBPH distance is *lower-is-better*, so increasing the threshold is *more permissive*, not less.

Names are sanitized server-side to `[a-zA-Z0-9 _-]` and spaces are converted to underscores on disk; the worker converts them back to spaces when reporting (`names_map`). Underscores in original names will be lost.

## MediaMTX configuration

[mediamtx/mediamtx.yml](mediamtx/mediamtx.yml) is intentionally minimal: API on `:9997`, HLS on `:8888`. All path config (auth, transport, source) is set per-path via the API at runtime, not in YAML. The default RTSP ingest port `:8554` is implicit (MediaMTX default) and is what the agent pushes to.

## Adding a remote camera

The backend's auto-spawned agent assumes the RTSP source is reachable from the backend host. For a camera on a different LAN, run `agent/agent.py` manually on that LAN:

```
python agent/agent.py http://<backend-host>:3000 <pathName> rtsp://<local-camera-ip>/...
```

Get `<pathName>` from the `streamKey` field in the `/add-camera` response. The agent will register-check, then push.
