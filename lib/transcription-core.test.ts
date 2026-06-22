import { describe, expect, it, vi } from "vitest";

import {
  hasGenuineWordTimestamps,
  isMissingCrossAttentionError,
  normalizeWordChunks,
  pipelineRuntimeOptions,
} from "../public/transcription-core.mjs";

describe("transcription worker helpers", () => {
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

  it("accepts only genuine one-word timestamp chunks", () => {
    expect(hasGenuineWordTimestamps({
      chunks: [
        { text: " Hello", timestamp: [0.2, 0.55] },
        { text: "world.", timestamp: [0.56, 1.02] },
      ],
    })).toBe(true);
    expect(hasGenuineWordTimestamps({
      chunks: [{ text: "Hello world", timestamp: [0.2, 1.02] }],
    })).toBe(false);
    expect(hasGenuineWordTimestamps({
      chunks: [{ text: "Hello", timestamp: [null, 1.02] }],
    })).toBe(false);
  });

  it("repairs tiny floating-point overlaps without estimating timings", () => {
    const chunks = normalizeWordChunks([
      { text: " Hello", timestamp: [0.2, 0.55] },
      { text: " world", timestamp: [0.549, 1.02] },
    ]) as { text: string; timestamp: [number, number] }[];
    expect(chunks).toEqual([
      { text: "Hello", timestamp: [0.2, 0.55] },
      { text: "world", timestamp: [0.55, 1.02] },
    ]);
  });

});
