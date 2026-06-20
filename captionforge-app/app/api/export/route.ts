import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const maxDuration = 600;

interface Segment {
  start: number;
  end: number;
  text: string;
  style: {
    fontFamily: string;
    fontSizePct: number;
    color: string;
    outlineColor: string;
    outlineWidthPct: number;
    bold: boolean;
    x: number; // %
    y: number; // %
    caps: "none" | "upper" | "lower" | "title";
  };
}

function applyCaps(t: string, caps: string) {
  if (caps === "upper") return t.toUpperCase();
  if (caps === "lower") return t.toLowerCase();
  if (caps === "title") return t.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return t;
}

function escapeDrawtext(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/%/g, "\\%");
}

function hexToFFColor(hex: string) {
  // FFmpeg drawtext wants 0xRRGGBB
  return "0x" + hex.replace("#", "");
}

function checkFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-version"]);
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

export async function POST(req: NextRequest) {
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    return NextResponse.json(
      {
        error: "FFmpeg is not installed on this server",
        detail:
          "Install FFmpeg and ensure it is on PATH. See the README's FFmpeg setup section for Windows/macOS/Linux instructions.",
      },
      { status: 501 }
    );
  }

  const dir = await mkdtemp(path.join(tmpdir(), "captionforge-"));
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const segmentsRaw = form.get("segments") as string | null;
    const resolution = (form.get("resolution") as string) || "original";
    const fps = (form.get("fps") as string) || "original";
    const quality = (form.get("quality") as string) || "high";

    if (!file || !segmentsRaw) {
      return NextResponse.json({ error: "Missing file or segments" }, { status: 400 });
    }

    const MAX_BYTES = 2 * 1024 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds the 2GB export limit" }, { status: 413 });
    }

    let segments: Segment[];
    try {
      segments = JSON.parse(segmentsRaw);
    } catch {
      return NextResponse.json({ error: "Segments must be valid JSON" }, { status: 400 });
    }

    const inputPath = path.join(dir, "input" + path.extname(file.name).slice(0, 6).replace(/[^a-zA-Z0-9.]/g, "") || ".mp4");
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

    // Probe original video height for percentage-based font sizing.
    const probe = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const p = spawn("ffprobe", [
        "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=p=0:s=x", inputPath,
      ]);
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.on("error", reject);
      p.on("exit", () => {
        const [w, h] = out.trim().split("x").map(Number);
        if (!w || !h) return reject(new Error("Could not read video dimensions"));
        resolve({ width: w, height: h });
      });
    });

    const filters = segments.map((seg) => {
      const fontPx = Math.round((seg.style.fontSizePct / 100) * probe.height);
      const outlinePx = Math.max(1, Math.round((seg.style.outlineWidthPct / 100) * fontPx));
      const text = escapeDrawtext(applyCaps(seg.text, seg.style.caps));
      const x = `(w-text_w)*${(seg.style.x / 100).toFixed(4)}`;
      const y = `(h-text_h)*${(seg.style.y / 100).toFixed(4)}`;
      return (
        `drawtext=text='${text}':fontsize=${fontPx}:fontcolor=${hexToFFColor(seg.style.color)}:` +
        `bordercolor=${hexToFFColor(seg.style.outlineColor)}:borderw=${outlinePx}:` +
        `x=${x}:y=${y}:enable='between(t,${seg.start.toFixed(3)},${seg.end.toFixed(3)})'`
      );
    });

    const outputPath = path.join(dir, "output.mp4");
    const vf = filters.length ? filters.join(",") : null;

    const args = ["-y", "-i", inputPath];
    if (vf) args.push("-vf", vf);
    if (resolution !== "original") {
      const map: Record<string, string> = { "720p": "1280:720", "1080p": "1920:1080", "1440p": "2560:1440", "4k": "3840:2160" };
      if (map[resolution]) args.push(...(vf ? [] : ["-vf", `scale=${map[resolution]}`]));
    }
    if (fps !== "original") args.push("-r", fps);
    const crf = quality === "maximum" ? "16" : quality === "standard" ? "23" : "19";
    args.push("-c:v", "libx264", "-preset", "slow", "-crf", crf, "-c:a", "aac", "-b:a", "192k", outputPath);

    await new Promise<void>((resolve, reject) => {
      const p = spawn("ffmpeg", args);
      let stderr = "";
      p.stderr.on("data", (d) => (stderr += d));
      p.on("error", reject);
      p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-2000)))));
    });

    const outBuf = await readFile(outputPath);
    const stats = await stat(outputPath);

    return new NextResponse(outBuf, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="captionforge-export.mp4"`,
        "X-File-Size": String(stats.size),
      },
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: "Render failed", detail: (err instanceof Error ? err.message : String(err)).slice(0, 1500) }, { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
