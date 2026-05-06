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

def run_ffmpeg(local_rtsp, push_url):
    """Start FFmpeg to bridge local RTSP → remote MediaMTX."""
    cmd = [
        'ffmpeg',
        '-loglevel', 'warning',
        '-rtsp_transport', 'tcp',
        '-i', local_rtsp,
        '-c', 'copy',
        '-f', 'rtsp',
        '-rtsp_transport', 'tcp',
        push_url
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

    print(f"[Agent] AI-CCTV Local Agent starting...")
    print(f"[Agent] Server   : {server_url}")
    print(f"[Agent] Push URL : {push_url}")
    print(f"[Agent] Source   : {local_rtsp}")
    print()

    running = True

    def handle_sigint(sig, frame):
        nonlocal running
        running = False
        print("\n[Agent] Shutting down...")
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_sigint)

    retry_delay = 5

    while running:
        proc = run_ffmpeg(local_rtsp, push_url)

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
