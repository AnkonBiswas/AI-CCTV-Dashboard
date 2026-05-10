#!/usr/bin/env python3
"""
AI-CCTV Local Agent
===================
Pulls a local RTSP stream and pushes it to the remote MediaMTX server.
Run this on any machine that can reach your local cameras.

Usage:
    python agent.py <server-url> <stream-key> <local-rtsp-url>

Example:
    python agent.py http://103.17.39.190:3000 abc123def456 rtsp://192.168.1.17:8080/h264.sdp

How it works:
    1. Polls the server to confirm the stream key is registered.
    2. Uses FFmpeg to pull from your local RTSP camera.
    3. Pushes the video to rtsp://<server>:8554/<stream-key> for MediaMTX.
    4. Auto-reconnects if the camera drops or the network hiccups.

Requirements:
    - FFmpeg must be installed and in your PATH.
      Windows: https://ffmpeg.org/download.html
      Linux/Mac: sudo apt install ffmpeg  /  brew install ffmpeg
"""

import subprocess
import sys
import time
import signal
import os
import urllib.request
import json
import re
import zipfile
import shutil

def get_server_host(server_url):
    """Extracts just the hostname/IP from a full URL like http://1.2.3.4:3000"""
    match = re.match(r'https?://([^:/]+)', server_url)
    return match.group(1) if match else server_url

def check_server(server_url, stream_key):
    """Verify the stream key exists on the server."""
    try:
        url = f"{server_url.rstrip('/')}/streams/{stream_key}"
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read())
            return data.get('ok', False)
    except Exception as e:
        print(f"[Agent] Server check failed: {e}")
        return False

def get_ffmpeg_command():
    """Finds the ffmpeg executable, checking local and system paths."""
    # 1. Check system PATH
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        return 'ffmpeg'
    except (FileNotFoundError, subprocess.CalledProcessError):
        pass

    # 2. Check local directory and parent (root)
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    for p in [os.path.join(here, 'ffmpeg.exe'), os.path.join(root, 'ffmpeg.exe')]:
        if os.path.exists(p):
            return p

    return None

def download_ffmpeg():
    """Downloads a portable ffmpeg.exe for Windows if missing."""
    if os.name != 'nt':
        return False

    url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    here = os.path.dirname(os.path.abspath(__file__))
    target = os.path.join(here, "ffmpeg.exe")
    zip_path = os.path.join(here, "ffmpeg.zip")

    # Wipe any leftover corrupt zip from a previous interrupted attempt.
    if os.path.exists(zip_path):
        try: os.remove(zip_path)
        except OSError: pass

    print("[Agent] FFmpeg missing. Attempting automatic download for Windows...")
    try:
        print(f"[Agent] Downloading from {url}...")
        with urllib.request.urlopen(url) as response, open(zip_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)

        # Verify the zip is intact before extracting.
        if not zipfile.is_zipfile(zip_path):
            raise RuntimeError("downloaded file is not a valid zip — try again or install ffmpeg manually")

        print("[Agent] Extracting ffmpeg.exe...")
        with zipfile.ZipFile(zip_path, 'r') as z:
            exe_member = next((m for m in z.namelist() if m.endswith('bin/ffmpeg.exe')), None)
            if not exe_member:
                raise RuntimeError("zip did not contain bin/ffmpeg.exe (unexpected build layout)")
            with z.open(exe_member) as source, open(target, 'wb') as dest:
                shutil.copyfileobj(source, dest)

        if not os.path.exists(target) or os.path.getsize(target) < 1_000_000:
            raise RuntimeError("ffmpeg.exe extracted but looks truncated")

        print(f"[Agent] Successfully installed to {target}")
        return target
    except Exception as e:
        print(f"[Agent] Auto-download failed: {e}")
        # Clean up an aborted target so a re-run sees a missing exe instead of a partial one.
        if os.path.exists(target):
            try: os.remove(target)
            except OSError: pass
    finally:
        if os.path.exists(zip_path):
            try: os.remove(zip_path)
            except OSError: pass
    return None

def check_ffmpeg():
    """Verify FFmpeg is installed and accessible, or try to auto-setup."""
    cmd = get_ffmpeg_command()
    if cmd:
        return cmd
    
    # Try auto-download
    cmd = download_ffmpeg()
    if cmd:
        return cmd
    
    print("=" * 60)
    print("ERROR: FFmpeg not found!")
    print("=" * 60)
    print("Install FFmpeg and make sure it is in your PATH:\n")
    print("  Windows : winget install -e --id Gyan.FFmpeg")
    print("            OR download from https://ffmpeg.org/download.html")
    print("  Ubuntu  : sudo apt install ffmpeg")
    print("  macOS   : brew install ffmpeg")
    print("\nAfter installing, close and reopen your terminal, then try again.")
    print("=" * 60)
    return None

_ffmpeg_timeout_flag_cache = None
def _ffmpeg_rtsp_timeout_flag(ffmpeg_cmd):
    """Return '-timeout' for ffmpeg 5+, '-stimeout' for older builds.

    ffmpeg 8.x removed `-stimeout` (option not found = process exits before
    even attempting the stream). Older ffmpeg 4.x/early 5.x used `-stimeout`.
    Sniffing the banner lets us support both without an upgrade requirement.
    """
    global _ffmpeg_timeout_flag_cache
    if _ffmpeg_timeout_flag_cache is not None:
        return _ffmpeg_timeout_flag_cache
    try:
        out = subprocess.run([ffmpeg_cmd, '-version'], capture_output=True, text=True, timeout=5)
        banner = (out.stdout + out.stderr).splitlines()[0] if (out.stdout or out.stderr) else ''
        m = re.search(r'ffmpeg version (\d+)', banner)
        major = int(m.group(1)) if m else 0
    except Exception:
        major = 0
    _ffmpeg_timeout_flag_cache = '-timeout' if major >= 5 else '-stimeout'
    return _ffmpeg_timeout_flag_cache


def run_ffmpeg(ffmpeg_cmd, local_rtsp, push_url):
    """Start FFmpeg to bridge local RTSP → remote MediaMTX.

    `-stimeout` is critical: without it, if the camera goes silent (phone
    sleeps, app closes, network blip), ffmpeg's RTSP read can block forever
    and our retry loop never sees an exit. 5s in microseconds is plenty for
    a healthy camera but bounded enough to recover quickly.
    """
    # ffmpeg 5+ uses `-timeout`; older builds use `-stimeout`. Both are RTSP
    # socket-IO timeouts in microseconds. We pick at runtime by sniffing the
    # version banner so this works on both old and new ffmpeg installs.
    cmd = [
        ffmpeg_cmd,
        '-loglevel', 'warning',
        # Input (camera) options
        '-rtsp_transport', 'tcp',
        _ffmpeg_rtsp_timeout_flag(ffmpeg_cmd), '5000000',
        '-i', local_rtsp,
        '-c', 'copy',
        # Output (MediaMTX) options
        '-f', 'rtsp',
        '-rtsp_transport', 'tcp',
        push_url,
    ]
    print(f"[Agent] Bridging stream:")
    print(f"  Source  : {local_rtsp}")
    print(f"  Destination: {push_url}")
    return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

def main():
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)

    server_url = sys.argv[1]      # e.g. http://103.17.39.190:3000
    stream_key = sys.argv[2]      # e.g. camera_abc123
    local_rtsp  = sys.argv[3]     # e.g. rtsp://192.168.1.17:8080/h264.sdp

    server_host = get_server_host(server_url)
    push_url = f"rtsp://{server_host}:8554/{stream_key}"

    ffmpeg_cmd = check_ffmpeg()
    if not ffmpeg_cmd:
        sys.exit(1)

    print(f"[Agent] AI-CCTV Local Agent starting...")
    print(f"[Agent] Server   : {server_url}")
    print(f"[Agent] Push URL : {push_url}")
    print(f"[Agent] Source   : {local_rtsp}")

    # Wait for server registration
    print(f"[Agent] Waiting for stream registration...")
    while not check_server(server_url, stream_key):
        time.sleep(1)
    print(f"[Agent] Stream registered. Connecting FFmpeg...")

    running = True

    def handle_sigint(sig, frame):
        nonlocal running
        running = False
        print("\n[Agent] Shutting down...")
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_sigint)

    retry_delay = 5

    while running:
        proc = run_ffmpeg(ffmpeg_cmd, local_rtsp, push_url)

        for line in proc.stdout:
            txt = line.rstrip()
            if txt:
                print(f"[FFmpeg] {txt}")

        proc.wait()

        if running:
            print(f"[Agent] Stream ended (exit code {proc.returncode}). Reconnecting in {retry_delay}s...")
            time.sleep(retry_delay)

if __name__ == '__main__':
    main()
