#!/bin/bash
set -e

# Virtual framebuffer — display :99, 1366×768, 24-bit colour
Xvfb :99 -screen 0 1366x768x24 -ac +extension GLX +render -noreset &
sleep 1

# VNC server — no password, only listens on localhost
x11vnc -display :99 -nopw -listen localhost -xkb -forever -quiet &

# noVNC web proxy — exposes VNC over WebSocket on port 6080
/usr/share/novnc/utils/novnc_proxy --vnc localhost:5900 --listen 6080 &

export DISPLAY=:99

echo ">>> noVNC ready at http://localhost:6080/vnc.html"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
