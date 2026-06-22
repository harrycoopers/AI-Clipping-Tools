import { describe, it, expect } from "vitest";
import {
  applyCaps,
  srtTime,
  parseSrtTime,
  parseSubs,
  toSRT,
  styleFor,
  applyPresetToSegments,
  splitSegment,
  mergeSegments,
  createSubtitleSegments,
  cleanTranscriptChunkText,
  clamp,
  ORIGINAL_DEFAULT,
  type Preset,
  type Segment,
} from "./subtitles";

let counter = 0;
const makeId = () => `id-${++counter}`;

const presetA: Preset = { id: "original", name: "Original", builtin: true, style: ORIGINAL_DEFAULT };
const presetB: Preset = {
  id: "viral",
  name: "Bold Viral",
  builtin: false,
  style: { ...ORIGINAL_DEFAULT, color: "#FFCA3A", fontSizePct: 9, caps: "upper" },
};
const presets = [presetA, presetB];

describe("applyCaps", () => {
  it("uppercases", () => expect(applyCaps("hello world", "upper")).toBe("HELLO WORLD"));
  it("lowercases", () => expect(applyCaps("HELLO", "lower")).toBe("hello"));
  it("title-cases each word", () => expect(applyCaps("hello there world", "title")).toBe("Hello There World"));
  it("leaves text unchanged for none", () => expect(applyCaps("Hello There", "none")).toBe("Hello There"));
});

describe("srt time formatting", () => {
  it("formats seconds to HH:MM:SS,mmm", () => {
    expect(srtTime(0)).toBe("00:00:00,000");
    expect(srtTime(3661.5)).toBe("01:01:01,500");
  });
  it("round-trips through parseSrtTime within 1ms", () => {
    const t = 125.432;
    expect(parseSrtTime(srtTime(t))).toBeCloseTo(t, 2);
  });
  it("parses both comma and dot millisecond separators", () => {
    expect(parseSrtTime("00:00:02,500")).toBeCloseTo(2.5);
    expect(parseSrtTime("00:00:02.500")).toBeCloseTo(2.5);
  });
});

describe("parseSubs", () => {
  it("parses a basic SRT", () => {
    const srt = `1\n00:00:01,000 --> 00:00:03,000\nHello world\n\n2\n00:00:03,000 --> 00:00:05,000\nSecond line`;
    const segs = parseSubs(srt);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ start: 1, end: 3, text: "Hello world" });
    expect(segs[1].text).toBe("Second line");
  });
  it("parses VTT and strips the WEBVTT header", () => {
    const vtt = `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHi there`;
    const segs = parseSubs(vtt);
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe("Hi there");
  });
  it("returns [] for text with no cue markers", () => {
    expect(parseSubs("just some notes")).toEqual([]);
  });
});

describe("toSRT", () => {
  it("serializes segments back to valid SRT", () => {
    const out = toSRT([{ start: 1, end: 2, text: "A" }, { start: 2, end: 3, text: "B" }]);
    expect(out).toContain("1\n00:00:01,000 --> 00:00:02,000\nA");
    expect(out).toContain("2\n00:00:02,000 --> 00:00:03,000\nB");
  });
});

describe("styleFor (preset + override merge)", () => {
  const seg: Segment = { id: "s1", start: 0, end: 2, text: "hi", presetId: "viral", styleOverride: null };

  it("uses the segment's preset style when no override", () => {
    expect(styleFor(seg, presets, "original").color).toBe("#FFCA3A");
    expect(styleFor(seg, presets, "original").fontSizePct).toBe(9);
  });

  it("applies a per-segment override on top of the preset", () => {
    const overridden = { ...seg, styleOverride: { color: "#FF0000" } };
    const s = styleFor(overridden, presets, "original");
    expect(s.color).toBe("#FF0000"); // override wins
    expect(s.fontSizePct).toBe(9);   // rest still from preset
  });

  it("an override on one segment does not change another segment", () => {
    const a = { ...seg, id: "a", styleOverride: { color: "#FF0000" } };
    const b = { ...seg, id: "b", styleOverride: null };
    expect(styleFor(a, presets, "original").color).toBe("#FF0000");
    expect(styleFor(b, presets, "original").color).toBe("#FFCA3A");
  });

  it("falls back to the default preset when the segment's preset is gone", () => {
    const orphan = { ...seg, presetId: "deleted-preset" };
    expect(styleFor(orphan, presets, "original").color).toBe("#FFFFFF"); // original default
  });
});

describe("applyPresetToSegments (auto-generate)", () => {
  it("tags every generated segment with the chosen preset id", () => {
    const raw = [
      { start: 0, end: 1, text: "one" },
      { start: 1, end: 2, text: "two" },
    ];
    const segs = applyPresetToSegments(raw, "viral", makeId);
    expect(segs).toHaveLength(2);
    expect(segs.every((s) => s.presetId === "viral")).toBe(true);
    expect(segs.every((s) => s.styleOverride === null)).toBe(true);
    expect(new Set(segs.map((s) => s.id)).size).toBe(2); // unique ids
  });
});

describe("splitSegment", () => {
  it("splits text in half and bisects the timestamp", () => {
    const seg: Segment = { id: "s", start: 0, end: 4, text: "a b c d", presetId: "viral", styleOverride: null };
    const [first, second] = splitSegment(seg, makeId);
    expect(first.text).toBe("a b");
    expect(second.text).toBe("c d");
    expect(first.end).toBe(2);
    expect(second.start).toBe(2);
    expect(second.id).not.toBe(first.id);
  });
});

describe("mergeSegments", () => {
  it("joins text and extends the end time", () => {
    const a: Segment = { id: "a", start: 0, end: 2, text: "hello", presetId: "viral", styleOverride: null };
    const b: Segment = { id: "b", start: 2, end: 4, text: "world", presetId: "viral", styleOverride: null };
    const merged = mergeSegments(a, b);
    expect(merged.text).toBe("hello world");
    expect(merged.end).toBe(4);
    expect(merged.id).toBe("a");
  });
});

describe("clamp", () => {
  it("constrains values to range", () => {
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(150, 0, 100)).toBe(100);
    expect(clamp(42, 0, 100)).toBe(42);
  });
});

describe("ORIGINAL_DEFAULT matches the spec", () => {
  it("is white, bold, thick black outline, bottom-centre, no background box", () => {
    expect(ORIGINAL_DEFAULT.color).toBe("#FFFFFF");
    expect(ORIGINAL_DEFAULT.bold).toBe(true);
    expect(ORIGINAL_DEFAULT.outlineColor).toBe("#000000");
    expect(ORIGINAL_DEFAULT.outlineWidthPct).toBeGreaterThanOrEqual(6);
    expect(ORIGINAL_DEFAULT.outlineWidthPct).toBeLessThanOrEqual(8);
    expect(ORIGINAL_DEFAULT.x).toBe(50);
    expect(ORIGINAL_DEFAULT.y).toBeGreaterThan(75); // lower area
    expect(ORIGINAL_DEFAULT.bgOpacity).toBe(0);     // no box
  });
});

describe("createSubtitleSegments", () => {
  it("removes cue-only non-speech annotations", () => {
    expect(cleanTranscriptChunkText("[Music]")).toBe("");
    expect(cleanTranscriptChunkText("♪ music ♪")).toBe("");
    expect(cleanTranscriptChunkText("(applause)")).toBe("");
    expect(cleanTranscriptChunkText("I love music")).toBe("I love music");

    const result = createSubtitleSegments([
      { text: "Hello", timestamp: [0, 0.4] },
      { text: "[Music]", timestamp: [0.4, 1.2] },
      { text: "there", timestamp: [1.2, 1.6] },
    ], { maxWords: 8, maxDuration: 5 });
    expect(result.map((cue) => cue.text)).toEqual(["Hello", "there"]);
    expect(result.some((cue) => /music/i.test(cue.text))).toBe(false);
  });

  it("splits on punctuation and preserves word timestamps", () => {
    const result = createSubtitleSegments([
      { text: "Hello", timestamp: [0, 0.4] },
      { text: "world.", timestamp: [0.4, 0.9] },
      { text: "Next", timestamp: [1.1, 1.4] },
      { text: "phrase", timestamp: [1.4, 1.9] },
    ], { maxWords: 8, maxDuration: 5 });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ start: 0, end: 0.9, text: "Hello world." });
    expect(result[1].words).toHaveLength(2);
  });

  it("enforces word and duration limits without overlapping cues", () => {
    const result = createSubtitleSegments([
      { text: "one", timestamp: [0, 0.5] },
      { text: "two", timestamp: [0.5, 1] },
      { text: "three", timestamp: [1, 1.5] },
      { text: "four", timestamp: [1.5, 2] },
    ], { maxWords: 2, maxDuration: 1.2 });
    expect(result.map((cue) => cue.text)).toEqual(["one two", "three four"]);
    expect(result[0].end).toBeLessThanOrEqual(result[1].start);
  });

  it("drops empty chunks and repairs missing timestamps", () => {
    const result = createSubtitleSegments([
      { text: " " },
      { text: "usable" },
      { text: "words" },
    ], { maxWords: 4, maxDuration: 5 });
    expect(result).toHaveLength(1);
    expect(result[0].end).toBeGreaterThan(result[0].start);
  });
});
