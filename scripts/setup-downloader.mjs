import { createWriteStream } from "node:fs";
import { chmod, cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

const target = join(process.cwd(), "tools", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const temporary = `${target}.download`;
const release = process.platform === "win32"
  ? "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.exe"
  : "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp";

await mkdir(dirname(target), { recursive: true });
console.log("Downloading the current yt-dlp nightly build...");
const response = await fetch(release, { redirect: "follow" });
if (!response.ok || !response.body) throw new Error(`yt-dlp download failed with HTTP ${response.status}.`);

try {
  await pipeline(response.body, createWriteStream(temporary));
  await rm(target, { force: true });
  await rename(temporary, target);
  if (process.platform !== "win32") await chmod(target, 0o755);
  console.log(`yt-dlp installed at ${target}`);
} catch (error) {
  await rm(temporary, { force: true }).catch(() => {});
  throw error;
}

if (process.platform === "win32") {
  const archive = join(process.cwd(), "tools", "ffmpeg.zip");
  const extracted = join(process.cwd(), "tools", "ffmpeg-extracted");
  const ffmpegTarget = join(process.cwd(), "tools", "ffmpeg.exe");
  const ffprobeTarget = join(process.cwd(), "tools", "ffprobe.exe");
  const ffmpegRelease = "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip";

  console.log("Downloading FFmpeg...");
  const ffmpegResponse = await fetch(ffmpegRelease, { redirect: "follow" });
  if (!ffmpegResponse.ok || !ffmpegResponse.body) {
    throw new Error(`FFmpeg download failed with HTTP ${ffmpegResponse.status}.`);
  }
  await pipeline(ffmpegResponse.body, createWriteStream(archive));
  await rm(extracted, { recursive: true, force: true });
  await mkdir(extracted, { recursive: true });

  await new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xf", archive, "-C", extracted], { windowsHide: true, shell: false });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Could not extract FFmpeg archive (code ${code}).`)));
  });

  async function findFile(directory, name) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        const found = await findFile(path, name);
        if (found) return found;
      } else if (entry.name.toLowerCase() === name) {
        return path;
      }
    }
    return "";
  }

  const ffmpegSource = await findFile(extracted, "ffmpeg.exe");
  const ffprobeSource = await findFile(extracted, "ffprobe.exe");
  if (!ffmpegSource || !ffprobeSource) throw new Error("The FFmpeg archive did not contain ffmpeg.exe and ffprobe.exe.");
  await cp(ffmpegSource, ffmpegTarget);
  await cp(ffprobeSource, ffprobeTarget);
  await rm(archive, { force: true });
  await rm(extracted, { recursive: true, force: true });
  console.log(`FFmpeg installed at ${ffmpegTarget}`);
} else {
  console.log("Install FFmpeg with your system package manager or set FFMPEG_PATH.");
}
