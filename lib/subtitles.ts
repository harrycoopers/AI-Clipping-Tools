// Pure, DOM-free logic shared by the editor and covered by tests.

export interface SubtitleStyle {
  fontFamily: string;
  customFontName: string | null;
  fontSizePct: number;
  color: string;
  outlineColor: string;
  outlineWidthPct: number;
  outlineOpacity: number;
  bold: boolean;
  italic: boolean;
  letterSpacing: number;
  lineSpacing: number;
  align: "left" | "center" | "right";
  x: number;
  y: number;
  maxWidthPct: number;
  wordsPerSubtitle: number;
  maxLines: number;
  bgColor: string;
  bgOpacity: number;
  bgPadding: number;
  cornerRadius: number;
  shadowColor: string;
  shadowBlur: number;
  shadowDistance: number;
  shadowOpacity: number;
  highlightColor: string;
  highlightBg: string;
  animation: string;
  caps: "none" | "upper" | "lower" | "title";
}

export interface Preset {
  id: string;
  name: string;
  builtin: boolean;
  style: SubtitleStyle;
}

export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  words?: SubtitleWord[];
  presetId: string;
  styleOverride: Partial<SubtitleStyle> | null;
}

export interface SubtitleWord {
  text: string;
  start: number;
  end: number;
}

export interface TranscriptChunk {
  text: string;
  timestamp?: [number | null, number | null];
}

const NON_SPEECH_CUE = /^(?:blank_audio|blank audio|music|musical interlude|instrumental|background music|applause|clapping|laughter|laughing|cheering|crowd noise|noise|silence)$/i;

/** Remove cue-only sound descriptions while preserving ordinary speech. */
export function cleanTranscriptChunkText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const withoutNotes = trimmed.replace(/[♪♫♬♩]+/g, "").trim();
  const cue = withoutNotes
    .replace(/^\[([^\]]+)\]$/, "$1")
    .replace(/^\(([^)]+)\)$/, "$1")
    .replace(/^<([^>]+)>$/, "$1")
    .trim();

  if (!withoutNotes || NON_SPEECH_CUE.test(cue)) return "";
  return trimmed.replace(/[♪♫♬♩]+/g, "").replace(/\s+/g, " ").trim();
}

export const ORIGINAL_DEFAULT: SubtitleStyle = {
  fontFamily: "Anton",
  customFontName: null,
  fontSizePct: 6.2,
  color: "#FFFFFF",
  outlineColor: "#000000",
  outlineWidthPct: 7,
  outlineOpacity: 1,
  bold: true,
  italic: false,
  letterSpacing: 0.2,
  lineSpacing: 1.1,
  align: "center",
  x: 50,
  y: 84,
  maxWidthPct: 82,
  wordsPerSubtitle: 5,
  maxLines: 2,
  bgColor: "#000000",
  bgOpacity: 0,
  bgPadding: 10,
  cornerRadius: 10,
  shadowColor: "#000000",
  shadowBlur: 6,
  shadowDistance: 2,
  shadowOpacity: 0.55,
  highlightColor: "#FFCA3A",
  highlightBg: "transparent",
  animation: "fade",
  caps: "upper",
};

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function applyCaps(t: string, caps: SubtitleStyle["caps"]): string {
  if (caps === "upper") return t.toUpperCase();
  if (caps === "lower") return t.toLowerCase();
  if (caps === "title") return t.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return t;
}

export function srtTime(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function parseSrtTime(str: string): number {
  const m = str.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

/** Parse SRT or VTT text into raw segments. */
export function parseSubs(text: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  if (!text.includes("-->")) return out;
  const blocks = text.replace(/^WEBVTT.*\n/, "").trim().split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.trim().split("\n");
    const tl = lines.find((l) => l.includes("-->"));
    if (!tl) continue;
    const [a, c] = tl.split("-->");
    const txt = lines.slice(lines.indexOf(tl) + 1).join(" ").trim();
    if (txt) out.push({ start: parseSrtTime(a), end: parseSrtTime(c), text: txt });
  }
  return out;
}

/** Serialize segments to SRT. */
export function toSRT(segments: Pick<Segment, "start" | "end" | "text">[]): string {
  return segments
    .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`)
    .join("\n");
}

/**
 * The effective style for a segment = its preset's style with any per-segment
 * override merged on top. This is the heart of "edit one caption without
 * touching the preset".
 */
export function styleFor(seg: Segment, presets: Preset[], defaultId: string): SubtitleStyle {
  const base =
    presets.find((p) => p.id === seg.presetId) ||
    presets.find((p) => p.id === defaultId) ||
    presets[0];
  return { ...base.style, ...(seg.styleOverride || {}) };
}

/** Apply a chosen preset to every generated segment (auto-generate behaviour). */
export function applyPresetToSegments(
  raw: { start: number; end: number; text: string; words?: SubtitleWord[] }[],
  presetId: string,
  makeId: () => string
): Segment[] {
  return raw.map((r) => ({
    id: makeId(),
    start: r.start,
    end: r.end,
    text: r.text,
    words: r.words,
    presetId,
    styleOverride: null,
  }));
}

/** Split a segment's text in half by word count (split-subtitle button). */
export function splitSegment(seg: Segment, makeId: () => string): Segment[] {
  const mid = (seg.start + seg.end) / 2;
  const words = seg.text.split(" ");
  const h = Math.ceil(words.length / 2);
  return [
    { ...seg, end: mid, text: words.slice(0, h).join(" ") },
    { ...seg, id: makeId(), start: mid, text: words.slice(h).join(" ") },
  ];
}

/** Merge a segment with the next one (merge-with-next button). */
export function mergeSegments(a: Segment, b: Segment): Segment {
  return {
    ...a,
    end: b.end,
    text: `${a.text} ${b.text}`.replace(/\s+/g, " ").trim(),
    words: a.words || b.words ? [...(a.words || []), ...(b.words || [])] : undefined,
  };
}

/**
 * Converts Whisper word timestamps into readable, ordered subtitle cues.
 * Boundaries prefer punctuation and pauses, while hard limits prevent long
 * blocks and invalid/overlapping timings.
 */
export function createSubtitleSegments(
  chunks: TranscriptChunk[],
  options: { maxWords: number; maxDuration: number; maxChars?: number } = {
    maxWords: 7,
    maxDuration: 4.5,
    maxChars: 72,
  }
): { start: number; end: number; text: string; words: SubtitleWord[] }[] {
  const maxWords = Math.max(1, options.maxWords);
  const maxDuration = Math.max(0.5, options.maxDuration);
  const maxChars = Math.max(12, options.maxChars ?? 72);
  const words: SubtitleWord[] = [];
  let fallbackStart = 0;

  for (const chunk of chunks) {
    const text = cleanTranscriptChunkText(chunk.text);
    if (!text) continue;
    const start = Math.max(fallbackStart, chunk.timestamp?.[0] ?? fallbackStart);
    const estimatedDuration = Math.max(0.18, text.replace(/\s+/g, "").length * 0.055);
    const end = Math.max(start + 0.08, chunk.timestamp?.[1] ?? start + estimatedDuration);
    words.push({ text, start, end });
    fallbackStart = end;
  }

  const out: { start: number; end: number; text: string; words: SubtitleWord[] }[] = [];
  let current: SubtitleWord[] = [];

  const flush = () => {
    if (!current.length) return;
    const previousEnd = out.at(-1)?.end ?? 0;
    const start = Math.max(previousEnd, current[0].start);
    const end = Math.max(start + 0.08, current.at(-1)?.end ?? start + 0.08);
    const text = current.map((word) => word.text).join(" ").replace(/\s+([,.!?;:])/g, "$1").trim();
    if (text) out.push({ start, end, text, words: current.map((word) => ({ ...word })) });
    current = [];
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const previous = current.at(-1);
    const candidate = [...current, word];
    const candidateText = candidate.map((item) => item.text).join(" ");
    const duration = word.end - candidate[0].start;
    const pauseBefore = previous ? word.start - previous.end : 0;
    const previousEndsPhrase = previous ? /[.!?;:]$/.test(previous.text) : false;

    if (
      current.length > 0 &&
      (pauseBefore >= 0.65 ||
        previousEndsPhrase ||
        candidate.length > maxWords ||
        duration > maxDuration ||
        candidateText.length > maxChars)
    ) {
      flush();
    }
    current.push(word);
  }
  flush();

  const valid = out.filter((segment) => segment.end > segment.start && segment.text.length > 0);
  const filtered: typeof valid = [];
  let repeatedKey = "";
  let repeatedCount = 0;
  let previousCandidate: (typeof valid)[number] | undefined;

  for (const segment of valid) {
    const key = segment.text
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}']+/gu, " ")
      .trim();
    const closeToPrevious = previousCandidate
      ? segment.start - previousCandidate.end <= Math.max(2, previousCandidate.end - previousCandidate.start)
      : false;

    if (key && key === repeatedKey && closeToPrevious) {
      repeatedCount += 1;
    } else {
      repeatedKey = key;
      repeatedCount = 1;
    }
    previousCandidate = segment;

    // Whisper can enter a decoder loop and emit the same short phrase many
    // times. Keep one genuine repeat, but reject the third adjacent duplicate.
    if (repeatedCount > 2 && key.split(/\s+/).length <= 10) continue;
    filtered.push(segment);
  }

  return filtered;
}
