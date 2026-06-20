import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

// Simple in-memory rate limiter (per server instance). Swap for a shared
// store (Redis, Upstash) in a multi-instance production deployment.
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 8;

function rateLimited(key: string) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > MAX_REQUESTS;
}

function splitIntoSegments(
  words: { word: string; start: number; end: number }[],
  wordsPerSubtitle: number
) {
  const segments: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < words.length; i += wordsPerSubtitle) {
    const chunk = words.slice(i, i + wordsPerSubtitle);
    if (!chunk.length) continue;
    segments.push({
      start: chunk[0].start,
      end: chunk[chunk.length - 1].end,
      text: chunk.map((w) => w.word).join(" ").trim(),
    });
  }
  return segments;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many transcription requests. Wait a minute and try again." }, { status: 429 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Transcription provider not configured" }, { status: 501 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const wordsPerSubtitle = Number(form.get("wordsPerSubtitle") || 5);
    const language = (form.get("language") as string) || undefined;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const MAX_BYTES = 500 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds the 500MB transcription limit" }, { status: 413 });
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(0, 200);

    const upstream = new FormData();
    upstream.append("file", file, safeName);
    upstream.append("model", "whisper-1");
    upstream.append("response_format", "verbose_json");
    upstream.append("timestamp_granularities[]", "word");
    if (language && language !== "auto") upstream.append("language", language);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Transcription provider error (${res.status})`, detail: errText.slice(0, 300) },
        { status: 502 }
      );
    }

    const data = await res.json();
    const words: { word: string; start: number; end: number }[] =
      (data.words || []).map((w: { word: string; start: number; end: number }) => ({ word: w.word, start: w.start, end: w.end }));

    const segments = words.length
      ? splitIntoSegments(words, wordsPerSubtitle)
      : (data.segments || []).map((s: { start: number; end: number; text: string }) => ({ start: s.start, end: s.end, text: s.text.trim() }));

    return NextResponse.json({ segments, language: data.language, words });
  } catch (err: unknown) {
    return NextResponse.json({ error: "Transcription failed", detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
