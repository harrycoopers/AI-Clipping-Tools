import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";

const port = Number(process.env.PORT || 4317);
const ytDlp = process.env.YT_DLP_PATH || join(process.cwd(), "tools", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const ffmpeg = process.env.FFMPEG_PATH || join(process.cwd(), "tools", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const workRoot = process.env.DOWNLOADER_TEMP_DIR || join(process.cwd(), ".captionforge-downloads");
const allowedHosts = [
  "youtube.com", "youtu.be", "tiktok.com", "twitch.tv", "kick.com",
];
const autoClipJobs = new Map();

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.DOWNLOADER_ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function validUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return ["http:", "https:"].includes(url.protocol)
      && allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function checkCommand(command, args = ["--version"]) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, shell: false });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", () => resolve({ available: false, version: "" }));
    child.on("close", (code) => resolve({
      available: code === 0,
      version: code === 0 ? output.trim().split(/\r?\n/)[0] || "available" : "",
    }));
  });
}

async function dependencyStatus() {
  const [ytDlpStatus, ffmpegStatus] = await Promise.all([
    checkCommand(ytDlp),
    checkCommand(ffmpeg, ["-version"]),
  ]);
  return { ytDlp: ytDlpStatus, ffmpeg: ffmpegStatus };
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16_384) throw new Error("Request is too large.");
  }
  return JSON.parse(body || "{}");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(stderr.trim().split(/\r?\n/).at(-1) || `${command} exited with code ${code}.`))
    );
  });
}

function rankHighlightWindows(samples, duration, maxClips = 8, clipDuration = 30) {
  if (!samples.length || !duration) return [];
  const maxAudio = Math.max(...samples.map((sample) => sample.audio), 1);
  const maxChat = Math.max(...samples.map((sample) => sample.chat || 0), 1);
  const sorted = samples.map((sample) => {
    const audio = sample.audio / maxAudio;
    const chat = (sample.chat || 0) / maxChat;
    return {
      ...sample,
      score: chat > 0 ? audio * 0.45 + chat * 0.55 : audio,
      reason: chat >= 0.65 ? "Chat activity spike" : "Audio reaction spike",
    };
  }).sort((a, b) => b.score - a.score);
  const selected = [];
  for (const sample of sorted) {
    if (selected.some((clip) => Math.abs((clip.start + clip.end) / 2 - sample.time) < clipDuration * 0.8)) continue;
    const start = Math.max(0, Math.min(duration - clipDuration, sample.time - clipDuration * 0.45));
    selected.push({
      start,
      end: Math.min(duration, start + clipDuration),
      score: sample.score,
      reason: sample.reason,
    });
    if (selected.length >= maxClips) break;
  }
  return selected.sort((a, b) => a.start - b.start);
}

async function downloadSource(url, directory) {
  const output = join(directory, "source.%(ext)s");
  const { stdout } = await runCommand(ytDlp, [
    "--no-playlist",
    "--no-simulate",
    "--dump-single-json",
    "--merge-output-format", "mp4",
    ...(isAbsolute(ffmpeg) ? ["--ffmpeg-location", ffmpeg] : []),
    "--format", "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
    "--output", output,
    url,
  ]);
  const metadata = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  const source = (await readdir(directory)).find((file) => /^source\.(mp4|mkv|webm|mov)$/i.test(file));
  if (!source) throw new Error("The VOD could not be downloaded for analysis.");
  return { file: join(directory, source), metadata };
}

function collectChatEvents(value, events = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectChatEvents(item, events);
    return events;
  }
  if (!value || typeof value !== "object") return events;
  const time = Number(
    value.content_offset_seconds
    ?? value.offset_seconds
    ?? value.video_offset_time
    ?? value.time_in_seconds
    ?? value.timestamp
  );
  const text = String(
    value.message?.body
    ?? value.message?.text
    ?? value.message
    ?? value.text
    ?? value.content
    ?? ""
  );
  if (Number.isFinite(time) && text) events.push({ time, text });
  for (const nested of Object.values(value)) collectChatEvents(nested, events);
  return events;
}

async function chatSamples(url, directory) {
  try {
    await runCommand(ytDlp, [
      "--skip-download",
      "--write-subs",
      "--sub-langs", "live_chat,chat",
      "--sub-format", "json",
      "--output", join(directory, "chat"),
      url,
    ]);
  } catch {
    return [];
  }
  const chatFile = (await readdir(directory)).find((file) => /^chat.*\.(json|jsonl)$/i.test(file));
  if (!chatFile) return [];
  const raw = await readFile(join(directory, chatFile), "utf8");
  let events = [];
  try {
    events = collectChatEvents(JSON.parse(raw));
  } catch {
    for (const line of raw.split(/\r?\n/)) {
      try { collectChatEvents(JSON.parse(line), events); } catch {}
    }
  }
  const buckets = new Map();
  for (const event of events) {
    const bucket = Math.floor(event.time / 5) * 5;
    const reaction = /\b(?:lol+|lmao+|lmfao+|haha+|rofl|kekw|omegalul|lulw|w+)\b/i.test(event.text) ? 3 : 1;
    buckets.set(bucket, (buckets.get(bucket) || 0) + reaction);
  }
  return [...buckets].map(([time, chat]) => ({ time, chat }));
}

async function probeDuration(file) {
  const ffprobe = process.env.FFPROBE_PATH || join(
    isAbsolute(ffmpeg) ? dirname(ffmpeg) : process.cwd(),
    process.platform === "win32" ? "ffprobe.exe" : "ffprobe"
  );
  const { stdout } = await runCommand(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  return Number(stdout.trim());
}

async function audioSamples(file) {
  const { stderr } = await runCommand(ffmpeg, [
    "-hide_banner", "-nostats", "-i", file,
    "-vn",
    "-af", "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
    "-f", "null", "-",
  ]);
  const samples = [];
  let time = 0;
  for (const line of stderr.split(/\r?\n/)) {
    const timeMatch = line.match(/pts_time:([\d.]+)/);
    if (timeMatch) time = Number(timeMatch[1]);
    const rmsMatch = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+)/);
    if (rmsMatch) {
      const db = Number(rmsMatch[1]);
      if (Number.isFinite(db)) samples.push({ time, audio: Math.max(0, 100 + db), chat: 0 });
    }
  }
  return samples;
}

async function createHighlight(file, directory, candidate, index) {
  const name = `highlight-${String(index + 1).padStart(2, "0")}.mp4`;
  const target = join(directory, name);
  await runCommand(ffmpeg, [
    "-y", "-ss", candidate.start.toFixed(3), "-i", file,
    "-t", (candidate.end - candidate.start).toFixed(3),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart",
    target,
  ]);
  return name;
}

async function analyzeAutoClips(url) {
  const jobId = randomUUID();
  const directory = join(workRoot, `auto-${jobId}`);
  await mkdir(directory, { recursive: true });
  const { file, metadata } = await downloadSource(url, directory);
  const duration = Number(metadata.duration) || await probeDuration(file);
  const [audio, chat] = await Promise.all([audioSamples(file), chatSamples(url, directory)]);
  const chatByBucket = new Map(chat.map((sample) => [Math.floor(sample.time / 5) * 5, sample.chat]));
  const samples = audio.map((sample) => ({
    ...sample,
    chat: chatByBucket.get(Math.floor(sample.time / 5) * 5) || 0,
  }));
  for (const sample of chat) {
    if (!samples.some((audioSample) => Math.abs(audioSample.time - sample.time) < 2.5)) {
      samples.push({ time: sample.time, audio: 0, chat: sample.chat });
    }
  }
  const candidates = rankHighlightWindows(samples, duration);
  if (!candidates.length) throw new Error("No strong highlight signals were found in this VOD.");
  const generated = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const name = await createHighlight(file, directory, candidates[index], index);
    generated.push({
      id: `${jobId}-${index}`,
      title: `Auto highlight ${index + 1}`,
      mediaPath: `/api/auto-clips/media/${jobId}/${name}`,
      duration: candidates[index].end - candidates[index].start,
      start: candidates[index].start,
      score: candidates[index].score,
      reason: candidates[index].reason,
      source: "Auto detected",
    });
  }
  const channel = metadata.uploader_id || metadata.channel_id || metadata.uploader || "";
  autoClipJobs.set(jobId, { directory, createdAt: Date.now() });
  return {
    jobId,
    platform: /twitch\.tv/i.test(url) ? "Twitch" : "Kick",
    channel,
    title: metadata.title || "VOD",
    duration,
    chatReplayAvailable: chat.length > 0,
    generated,
    warning: !chat.length
      ? "Historical chat replay was unavailable, so highlights were ranked from audio reaction spikes."
      : "",
  };
}

async function serveAutoClipMedia(req, res, pathname) {
  const match = pathname.match(/^\/api\/auto-clips\/media\/([a-f0-9-]+)\/(highlight-\d+\.mp4|imported\.mp4)$/i);
  if (!match) return false;
  const job = autoClipJobs.get(match[1]);
  if (!job) return json(res, 404, { error: "This highlight has expired." });
  const file = join(job.directory, match[2]);
  const info = await stat(file);
  const range = req.headers.range;
  cors(res);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", "video/mp4");
  if (range) {
    const parsed = range.match(/bytes=(\d+)-(\d*)/);
    const start = parsed ? Number(parsed[1]) : 0;
    const end = parsed?.[2] ? Number(parsed[2]) : info.size - 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${info.size}`,
      "Content-Length": end - start + 1,
    });
    createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Length": info.size });
    createReadStream(file).pipe(res);
  }
  return true;
}

async function runDownload(url, directory) {
  const output = join(directory, "%(title).180B [%(id)s].%(ext)s");
  const format = "bestvideo[height<=1080][fps<=60]+bestaudio/best[height<=1080][fps<=60]/best[height<=1080]/best";
  const args = [
    "--no-playlist",
    "--restrict-filenames",
    "--merge-output-format", "mp4",
    "--recode-video", "mp4",
    ...(isAbsolute(ffmpeg) ? ["--ffmpeg-location", ffmpeg] : []),
    "--format", format,
    "--output", output,
    "--no-progress",
    url,
  ];

  await new Promise((resolve, reject) => {
    const child = spawn(ytDlp, args, { windowsHide: true, shell: false });
    let errorText = "";
    child.stderr.on("data", (chunk) => { errorText += chunk.toString(); });
    child.on("error", (error) => reject(
      error.code === "ENOENT"
        ? new Error("yt-dlp is not installed. Install yt-dlp and FFmpeg, then restart the downloader service.")
        : error
    ));
    child.on("close", (code) => code === 0
      ? resolve()
      : reject(new Error(errorText.trim().split("\n").at(-1) || `yt-dlp exited with code ${code}.`))
    );
  });

  const files = await readdir(directory);
  const video = files.find((file) => /\.(mp4|mkv|webm|mov)$/i.test(file));
  if (!video) throw new Error("The platform returned no downloadable video.");
  return join(directory, video);
}

createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", "http://localhost");
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "GET" && req.url === "/health") {
    const dependencies = await dependencyStatus();
    return json(res, 200, { ok: true, ...dependencies });
  }
  if (req.method === "GET" && requestUrl.pathname.startsWith("/api/auto-clips/media/")) {
    if (await serveAutoClipMedia(req, res, requestUrl.pathname)) return;
  }
  if (req.method === "POST" && req.url === "/api/auto-clips/analyze") {
    try {
      const body = await readJson(req);
      if (!validUrl(body.url) || !/(twitch\.tv|kick\.com)/i.test(body.url)) {
        return json(res, 400, { error: "Enter a Twitch or Kick VOD URL." });
      }
      const dependencies = await dependencyStatus();
      if (!dependencies.ytDlp.available || !dependencies.ffmpeg.available) {
        return json(res, 503, {
          error: "Auto Clips requires yt-dlp and FFmpeg. Run \"npm run downloader:setup\" first.",
          ...dependencies,
        });
      }
      return json(res, 200, await analyzeAutoClips(body.url));
    } catch (error) {
      return json(res, 500, { error: error instanceof Error ? error.message : "VOD analysis failed." });
    }
  }
  if (req.method === "POST" && req.url === "/api/auto-clips/import") {
    try {
      const body = await readJson(req);
      if (!validUrl(body.url) || !/(twitch\.tv|kick\.com)/i.test(body.url)) {
        return json(res, 400, { error: "Enter a supported Twitch or Kick clip URL." });
      }
      const dependencies = await dependencyStatus();
      if (!dependencies.ytDlp.available || !dependencies.ffmpeg.available) {
        return json(res, 503, { error: "Clip import requires yt-dlp and FFmpeg." });
      }
      const jobId = randomUUID();
      const directory = join(workRoot, `auto-${jobId}`);
      await mkdir(directory, { recursive: true });
      const { file, metadata } = await downloadSource(body.url, directory);
      const imported = join(directory, "imported.mp4");
      await runCommand(ffmpeg, [
        "-y", "-i", file,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
        imported,
      ]);
      autoClipJobs.set(jobId, { directory, createdAt: Date.now() });
      return json(res, 200, {
        title: metadata.title || "Imported clip",
        mediaPath: `/api/auto-clips/media/${jobId}/imported.mp4`,
      });
    } catch (error) {
      return json(res, 500, { error: error instanceof Error ? error.message : "Clip import failed." });
    }
  }
  if (req.method !== "POST" || req.url !== "/api/download") return json(res, 404, { error: "Not found." });

  let directory = "";
  try {
    const body = await readJson(req);
    if (!validUrl(body.url)) return json(res, 400, { error: "Unsupported or invalid video URL." });
    const dependencies = await dependencyStatus();
    if (!dependencies.ytDlp.available || !dependencies.ffmpeg.available) {
      return json(res, 503, {
        error: "Downloader dependencies are missing. Run \"npm run downloader:setup\", restart the service, and try again.",
        ...dependencies,
      });
    }

    directory = join(workRoot, randomUUID());
    await mkdir(directory, { recursive: true });
    const file = await runDownload(body.url, directory);
    const info = await stat(file);
    const filename = basename(file);
    cors(res);
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": info.size,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
    const stream = createReadStream(file);
    stream.pipe(res);
    stream.on("close", () => void rm(directory, { recursive: true, force: true }));
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
    json(res, 500, { error: error instanceof Error ? error.message : "Download failed." });
  }
}).listen(port, process.env.DOWNLOADER_HOST || "127.0.0.1", async () => {
  await mkdir(workRoot, { recursive: true });
  console.log(`CaptionForge downloader listening on http://127.0.0.1:${port}`);
});
