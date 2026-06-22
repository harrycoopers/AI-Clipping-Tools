FROM node:20-bookworm-slim

  RUN apt-get update && \
      apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-pip ca-certificates && \
      python3 -m pip install --break-system-packages \
      --no-cache-dir --pre "yt-dlp[default,curl-cffi]" && \
      rm -rf /var/lib/apt/lists/*

  WORKDIR /app

  COPY server ./server

  ENV DOWNLOADER_HOST=0.0.0.0
  ENV YT_DLP_PATH=/usr/local/bin/yt-dlp
  ENV FFMPEG_PATH=/usr/bin/ffmpeg

  CMD ["node", "server/downloader-server.mjs"