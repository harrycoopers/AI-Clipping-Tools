import { describe, expect, it, vi } from "vitest";

import {
  detectSpeechRegions,
  isMissingCrossAttentionError,
  offsetTimestampChunks,
  pipelineRuntimeOptions,
  recoverWordTimestamps,
} from "../public/transcription-core.mjs";
import { createSubtitleSegments } from "./subtitles";

describe("transcription worker helpers", () => {
  it("finds speech and excludes long digital silence", () => {
    const audio = new Float32Array(16_000 * 8);
    for (let index = 16_000 * 3; index < 16_000 * 4; index += 1) {
      audio[index] = Math.sin(index / 8) * 0.12;
    }
    const regions = detectSpeechRegions(audio);
    expect(regions).toHaveLength(1);
    expect(regions[0].start).toBeGreaterThan(2.7);
    expect(regions[0].end).toBeLessThan(4.3);
  });

  it("restores source timeline offsets after speech-only transcription", () => {
    expect(offsetTimestampChunks([
      { text: "who", timestamp: [0.1, 0.3] },
      { text: "is", timestamp: [0.3, 0.45] },
      { text: "this", timestamp: [0.45, 0.8] },
    ], 5, 6)).toEqual([
      { text: "who", timestamp: [5.1, 5.3] },
      { text: "is", timestamp: [5.3, 5.45] },
      { text: "this", timestamp: [5.45, 5.8] },
    ]);
  });

  it("forces the WASM backend instead of allowing WebGPU auto-selection", () => {
    expect(pipelineRuntimeOptions("wasm", vi.fn())).toMatchObject({
      device: "wasm",
      dtype: "q8",
    });
  });

  it("uses the optimized WebGPU model configuration only for WebGPU", () => {
    expect(pipelineRuntimeOptions("webgpu", vi.fn())).toMatchObject({
      device: "webgpu",
      dtype: { encoder_model: "fp16", decoder_model_merged: "q4" },
    });
  });

  it("recognizes missing cross-attention failures", () => {
    expect(isMissingCrossAttentionError(
      new Error("Model outputs must contain cross attentions to extract timestamps")
    )).toBe(true);
  });

  it("preserves direct one-word timestamp chunks", () => {
    expect(recoverWordTimestamps({
      chunks: [
        { text: " Hello", timestamp: [0.2, 0.55] },
        { text: "world.", timestamp: [0.56, 1.02] },
      ],
    }, 1.1)).toMatchObject({
      quality: "word",
      chunks: [
        { text: "Hello", timestamp: [0.2, 0.55] },
        { text: "world.", timestamp: [0.56, 1.02] },
      ],
    });
  });

  it("repairs punctuation chunks, a null final end, and tiny overlaps", () => {
    expect(recoverWordTimestamps({
      chunks: [
        { text: " Hello", timestamp: [0.2, 0.55] },
        { text: ",", timestamp: [0.55, 0.57] },
        { text: " world", timestamp: [0.549, 1.02] },
        { text: " again", timestamp: [1.03, null] },
      ],
    }, 1.4)).toMatchObject({
      quality: "word",
      chunks: [
        { text: "Hello,", timestamp: [0.2, 0.57] },
        { text: "world", timestamp: [0.57, 1.02] },
        { text: "again", timestamp: [1.03, 1.4] },
      ],
    });
  });

  it("subdivides only inside a model-timed multi-word span", () => {
    const result = recoverWordTimestamps({
      chunks: [
        { text: "This grouped phrase", timestamp: [2, 3.2] },
        { text: "ends", timestamp: [3.2, 3.6] },
      ],
    }, 4);
    expect(result.quality).toBe("recovered-word");
    expect(result.chunks.map((chunk: { text: string }) => chunk.text)).toEqual(["This", "grouped", "phrase", "ends"]);
    expect(result.chunks[0].timestamp[0]).toBe(2);
    expect(result.chunks.at(-1)?.timestamp[1]).toBe(3.6);
  });

  it("rejects text when most chunks have no model timestamp boundary", () => {
    expect(recoverWordTimestamps({
      chunks: [
        { text: "one" },
        { text: "two" },
        { text: "three", timestamp: [1, null] },
      ],
    }, 2)).toMatchObject({ quality: "none", chunks: [] });
  });

  it("turns recovered word timings into accurately bounded subtitle cues", () => {
    const recovered = recoverWordTimestamps({
      chunks: [
        { text: "Testing", timestamp: [0, 0.4] },
        { text: "accurate", timestamp: [0.39, 0.8] },
        { text: "word timing", timestamp: [0.8, 1.6] },
        { text: "works", timestamp: [1.6, null] },
        { text: ".", timestamp: [1.95, 2] },
      ],
    }, 2);

    const timedChunks = recovered.chunks.map((chunk: {
      text: string;
      timestamp: number[];
    }) => ({
      text: chunk.text,
      timestamp: [chunk.timestamp[0] ?? null, chunk.timestamp[1] ?? null] as [
        number | null,
        number | null,
      ],
    }));
    const subtitles = createSubtitleSegments(timedChunks, {
      maxWords: 8,
      maxDuration: 5,
    });

    expect(recovered.quality).toBe("recovered-word");
    expect(subtitles).toHaveLength(1);
    expect(subtitles[0]).toMatchObject({
      start: 0,
      end: 2,
      text: "Testing accurate word timing works.",
    });
    expect(subtitles[0].words).toHaveLength(5);
  });

});
