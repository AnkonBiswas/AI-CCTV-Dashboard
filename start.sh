#!/usr/bin/env bash
# AI Face Recognition Dashboard launcher (macOS / Linux).
# Mirrors start.bat behavior: kill stale services, start MediaMTX → backend → frontend,
# stream their logs, and tear them all down on Ctrl-C.

set -u

# Resolve script directory so this works no matter where it's invoked from.
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

echo "=========================================="
echo " AI Face Recognition Dashboard"
echo "=========================================="

# ── Dependency probes ────────────────────────────────────────
PYTHON_BIN="${PYTHON:-$(command -v python3 || command -v python || true)}"
if [[ -z "$PYTHON_BIN" ]]; then
  echo "ERROR: python3 not found. Install Python 3, or set PYTHON=/path/to/python in your env."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found. Install Node.js 18+."
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "WARNING: ffmpeg not found on PATH. The local agent will fail to bridge cameras."
  echo "  macOS:  brew install ffmpeg"
  echo "  Linux:  sudo apt install ffmpeg   # or your distro's equivalent"
fi

if [[ ! -x "mediamtx/mediamtx" ]]; then
  echo "ERROR: mediamtx/mediamtx (executable) not found."
  echo "  1. Download the matching macOS/Linux build from"
  echo "     https://github.com/bluenviron/mediamtx/releases"
  echo "  2. Extract the 'mediamtx' binary into this repo's mediamtx/ folder."
  echo "  3. Run:  chmod +x mediamtx/mediamtx"
  exit 1
fi

# ── Stop anything we'd collide with ──────────────────────────
echo "[1/4] Cleaning up existing services..."
pkill -f "mediamtx/mediamtx"          2>/dev/null || true
pkill -f "node[[:space:]].*server\.js" 2>/dev/null || true
pkill -f "python.*-m[[:space:]]http\.server[[:space:]]8080" 2>/dev/null || true
sleep 1

# ── Start each service in the background, logging to logs/ ───
PIDS=()
start_service() {
  local name="$1"; shift
  local log="$LOG_DIR/$name.log"
  echo "[$name] starting (log: $log)"
  ( "$@" ) >"$log" 2>&1 &
  PIDS+=("$!")
}

echo "[2/4] Starting MediaMTX (stream server)..."
( cd mediamtx && ./mediamtx ) >"$LOG_DIR/mediamtx.log" 2>&1 &
PIDS+=("$!")
sleep 3

echo "[3/4] Starting Backend (AI controller)..."
( cd backend && npm start ) >"$LOG_DIR/backend.log" 2>&1 &
PIDS+=("$!")
sleep 2

echo "[4/4] Starting Frontend (static server on :8080)..."
( cd frontend && "$PYTHON_BIN" -m http.server 8080 ) >"$LOG_DIR/frontend.log" 2>&1 &
PIDS+=("$!")

# ── Cleanup on Ctrl-C / script exit ──────────────────────────
cleanup() {
  echo
  echo "Stopping services..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  # Give them a chance to exit cleanly
  for _ in 1 2 3 4 5; do
    sleep 0.3
    local alive=0
    for pid in "${PIDS[@]}"; do
      kill -0 "$pid" 2>/dev/null && alive=1
    done
    [[ $alive -eq 0 ]] && break
  done
  # Force any holdouts
  for pid in "${PIDS[@]}"; do
    kill -9 "$pid" 2>/dev/null || true
  done
  exit 0
}
trap cleanup INT TERM

echo
echo "=========================================="
echo " SYSTEM READY"
echo " Dashboard:  http://localhost:8080"
echo " Logs:       $LOG_DIR/{mediamtx,backend,frontend}.log"
echo "=========================================="
echo " Tail a log:    tail -f logs/backend.log"
echo " Stop all:      Ctrl-C"
echo

# Block until any child exits or user hits Ctrl-C
wait -n 2>/dev/null || wait
cleanup
