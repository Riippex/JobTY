FROM python:3.11-slim

WORKDIR /app

# Virtual display stack: Xvfb + x11vnc + noVNC (so the user can see the
# browser during manual login via http://localhost:6080/vnc.html)
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    novnc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install chromium --with-deps

COPY . .
RUN mkdir -p data/profiles data/screenshots data/sessions

RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
