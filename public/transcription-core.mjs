export function normalizeTranscriptionError(error, backend) {
  const message = error instanceof Error ? error.message : String(error);
  if (/memory|allocation|buffer|out of bounds/i.test(message)) {
    return "The transcription model ran out of memory. Close other tabs or choose the Fast model.";
  }
  if (backend === "webgpu" && /webgpu|gpu|adapter|device|shader|pipeline/i.test(message)) {
    return "WebGPU could not run this model on this device. Retrying with CPU/WASM should resolve this.";
  }
  if (backend === "wasm" && /wasm|webassembly|onnx|backend|execution provider/i.test(message)) {
    return `CPU/WASM transcription could not start: ${message}`;
  }
  if (/fetch|network|download|404/i.test(message)) {
    return "The AI model could not be downloaded. Check the connection and retry.";
  }
  return message || "Transcription failed.";
}

export function isMissingCrossAttentionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /cross[\s_-]?attentions?|output_attentions/i.test(message);
}

export function recoverWordTimestamps(result, audioDuration) {
  const chunks = Array.isArray(result?.chunks) ? result.chunks : [];
  if (!chunks.length) return { chunks: [], quality: "none", rawTimedRatio: 0 };

  const prepared = chunks.map((chunk, index) => {
    const text = String(chunk?.text || "").trim();
    const rawStart = chunk?.timestamp?.[0];
    const rawEnd = chunk?.timestamp?.[1];
    const start = rawStart == null ? null : Number(rawStart);
    const end = rawEnd == null ? null : Number(rawEnd);
    return {
      index,
      text,
      start: Number.isFinite(start) ? start : null,
      end: Number.isFinite(end) ? end : null,
      hasRawTiming: Number.isFinite(start) || Number.isFinite(end),
    };
  }).filter((chunk) => chunk.text);

  const rawTimedRatio = prepared.filter((chunk) => chunk.hasRawTiming).length / Math.max(1, prepared.length);
  if (rawTimedRatio < 0.5) return { chunks: [], quality: "none", rawTimedRatio };

  const words = [];
  const precise = (value) => Math.round(value * 1000) / 1000;
  let previousEnd = 0;
  for (let index = 0; index < prepared.length; index += 1) {
    const chunk = prepared[index];
    const nextTimedStart = prepared.slice(index + 1).find((item) => item.start != null)?.start;
    const start = Math.max(0, chunk.start ?? previousEnd);
    const fallbackEnd = nextTimedStart ?? audioDuration ?? start + 0.35;
    const end = Math.max(start + 0.02, chunk.end ?? fallbackEnd);

    // Whisper can return punctuation as its own timed chunk. Attach it to the
    // preceding word while retaining the model's end boundary.
    if (/^[\p{P}\p{S}]+$/u.test(chunk.text) && words.length) {
      words.at(-1).text += chunk.text;
      words.at(-1).timestamp[1] = precise(Math.max(words.at(-1).timestamp[1], end));
      previousEnd = words.at(-1).timestamp[1];
      continue;
    }

    const parts = chunk.text.split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const weights = parts.map((part) => Math.max(1, part.replace(/[^\p{L}\p{N}]/gu, "").length));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    let elapsed = 0;
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const partStart = start + ((end - start) * elapsed) / totalWeight;
      elapsed += weights[partIndex];
      const partEnd = start + ((end - start) * elapsed) / totalWeight;
      const repairedStart = Math.max(previousEnd, partStart);
      const repairedEnd = Math.max(repairedStart + 0.02, partEnd);
      words.push({
        text: parts[partIndex],
        timestamp: [precise(repairedStart), precise(repairedEnd)],
      });
      previousEnd = repairedEnd;
    }
  }

  const quality = words.length
    ? rawTimedRatio >= 0.9 && prepared.every((chunk) => chunk.text.split(/\s+/).filter(Boolean).length === 1)
      ? "word"
      : "recovered-word"
    : "none";
  return { chunks: words, quality, rawTimedRatio };
}

export function pipelineRuntimeOptions(device, progressCallback) {
  if (device === "webgpu") {
    return {
      device: "webgpu",
      dtype: { encoder_model: "fp16", decoder_model_merged: "q4" },
      progress_callback: progressCallback,
    };
  }

  return {
    device: "wasm",
    dtype: "q8",
    progress_callback: progressCallback,
  };
}
