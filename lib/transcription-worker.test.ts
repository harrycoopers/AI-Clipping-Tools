import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const worker = readFileSync(join(process.cwd(), "public", "transcription.worker.mjs"), "utf8");

describe("transcription worker word timing configuration", () => {
  it("uses timestamp-compatible Transformers.js Whisper exports", () => {
    expect(worker).toContain('"Xenova/whisper-tiny"');
    expect(worker).toContain('"Xenova/whisper-base"');
    expect(worker).toContain('"Xenova/whisper-small"');
    expect(worker).not.toContain('"onnx-community/whisper-');
  });

  it("requires genuine word timestamps and never estimates them from segments", () => {
    expect(worker).toContain('return_timestamps: "word"');
    expect(worker).toContain("recoverWordTimestamps");
    expect(worker).not.toContain("using segment timing");
    expect(worker).not.toContain("expandChunksToWords");
  });

  it("cache-busts the helper module and announces successful startup", () => {
    expect(worker).toMatch(/transcription-core\.mjs\?v=\d+/);
    expect(worker).toContain('send("ready"');
  });
});
