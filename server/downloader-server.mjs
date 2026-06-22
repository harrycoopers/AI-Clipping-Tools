import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";

const port = Number(process.env.PORT || 4317);
const ytDlp = process.env.YT_DLP_PATH || "yt-dlp";
const workRoot = process.env.DOWNLOADER_TEMP_DIR || join(process.cwd(), ".captionforge-downloads");
const allowedHosts = [
  "youtube.com", "youtu.be", "tiktok.com", "twitch.tv", "kick.com",
];

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.DOWNLOADER_ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
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

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16_384) throw new Error("Request is too large.");
  }
  return JSON.parse(body || "{}");
}

async function runDownload(url, directory) {
  const output = join(directory, "%(title).180B [%(id)s].%(ext)s");
  const format = "bestvideo[height<=1080][fps<=60]+bestaudio/best[height<=1080][fps<=60]/best[height<=1080]/best";
  const args = [
    "--no-playlist",
    "--restrict-filenames",
    "--merge-output-format", "mp4",
    "--recode-video", "mp4",
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
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true });
  if (req.method !== "POST" || req.url !== "/api/download") return json(res, 404, { error: "Not found." });

  let directory = "";
  try {
    const body = await readJson(req);
    if (!validUrl(body.url)) return json(res, 400, { error: "Unsupported or invalid video URL." });

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
}).listen(port, "127.0.0.1", async () => {
  await mkdir(workRoot, { recursive: true });
  console.log(`CaptionForge downloader listening on http://127.0.0.1:${port}`);
});
