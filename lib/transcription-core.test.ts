import { describe, expect, it, vi } from "vitest";

import {
  isMissingCrossAttentionError,
  pipelineRuntimeOptions,
  recoverWordTimestamps,
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

});
