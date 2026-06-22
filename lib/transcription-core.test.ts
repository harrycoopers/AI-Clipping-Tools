import { describe, expect, it, vi } from "vitest";

import {
  expandChunksToWords,
  isMissingCrossAttentionError,
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

  it("converts segment timestamps to contiguous word timestamps", () => {
    const words = expandChunksToWords([
      { text: "A longer word.", timestamp: [2, 5] },
    ]) as { text: string; timestamp: [number, number] }[];

    expect(words.map((word) => word.text)).toEqual(["A", "longer", "word."]);
    expect(words[0].timestamp[0]).toBe(2);
    expect(words.at(-1)?.timestamp[1]).toBe(5);
    expect(words[0].timestamp[1]).toBe(words[1].timestamp[0]);
    expect(words[1].timestamp[1]).toBe(words[2].timestamp[0]);
    expect(words[1].timestamp[1] - words[1].timestamp[0]).toBeGreaterThan(
      words[0].timestamp[1] - words[0].timestamp[0]
    );
  });
});
