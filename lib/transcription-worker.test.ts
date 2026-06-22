import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const worker = readFileSync(join(process.cwd(), "public", "transcription.worker.mjs"), "utf8");

describe("transcription worker word timing configuration", () => {
  it("uses timestamp-compatible Transformers.js Whisper exports", () => {
    expect(worker).toContain('"Xenova/whisper-tiny"');
    expect(worker).toContain('"Xenova/whisper-base"');
    expect(worker).toContain('"Xenova/whisper-small"');
    expect(worker).toContain('"Xenova/whisper-tiny.en"');
    expect(worker).toContain('"Xenova/whisper-base.en"');
    expect(worker).toContain('"Xenova/whisper-small.en"');
    expect(worker).not.toContain('"onnx-community/whisper-');
  });

  it("requires genuine word timestamps and never estimates them from segments", () => {
    expect(worker).toContain('return_timestamps: "word"');
    expect(worker).toContain("recoverWordTimestamps");
    expect(worker).toContain("detectSpeechRegions");
    expect(worker).toContain("offsetTimestampChunks");
    expect(worker).toContain("prepareAudioForRecognition");
    expect(worker).not.toContain("using segment timing");
    expect(worker).not.toContain("expandChunksToWords");
  });

  it("uses deterministic decoding with repetition protection", () => {
    expect(worker).toContain("do_sample: false");
    expect(worker).toContain("temperature: 0");
    expect(worker).toContain("repetition_penalty: 1.08");
    expect(worker).toContain("condition_on_prev_tokens: false");
    expect(worker).toContain('num_beams: message.model === "accurate" ? 5 : 1');
    expect(worker).toContain('no_speech_threshold: 0.82');
  });

  it("never passes multilingual options to an English-only model", () => {
    expect(worker).toContain("if (!isEnglishOnlyLanguage(message.language))");
    expect(worker).toContain('options.task = "transcribe"');
    expect(worker).toContain('options.language = message.language === "auto" ? null : message.language');
    expect(worker.indexOf("if (!isEnglishOnlyLanguage(message.language))"))
      .toBeLessThan(worker.indexOf('options.task = "transcribe"'));
  });

  it("cache-busts the helper module and announces successful startup", () => {
    expect(worker).toMatch(/transcription-core\.mjs\?v=\d+/);
    expect(worker).toContain('send("ready"');
  });
});
