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

export function expandChunksToWords(chunks) {
  const words = [];

  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    const text = String(chunk?.text || "").trim();
    if (!text) continue;

    const parts = text.split(/\s+/).filter(Boolean);
    const start = Number(chunk?.timestamp?.[0]);
    const end = Number(chunk?.timestamp?.[1]);
    const hasTimestamp = Number.isFinite(start) && Number.isFinite(end) && end > start;
    const weights = parts.map((part) => Math.max(1, part.replace(/[^\p{L}\p{N}]/gu, "").length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let elapsedWeight = 0;

    for (let index = 0; index < parts.length; index += 1) {
      const wordStart = elapsedWeight;
      elapsedWeight += weights[index];
      const timestamp = hasTimestamp
        ? [
            start + ((end - start) * wordStart) / totalWeight,
            start + ((end - start) * elapsedWeight) / totalWeight,
          ]
        : null;
      words.push({ text: parts[index], timestamp });
    }
  }

  return words;
}
