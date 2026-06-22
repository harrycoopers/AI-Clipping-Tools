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

export function hasGenuineWordTimestamps(result) {
  const chunks = Array.isArray(result?.chunks) ? result.chunks : [];
  if (!chunks.length) return false;
  let previousEnd = 0;

  for (const chunk of chunks) {
    const text = String(chunk?.text || "").trim();
    const rawStart = chunk?.timestamp?.[0];
    const rawEnd = chunk?.timestamp?.[1];
    if (rawStart == null || rawEnd == null) return false;
    const start = Number(rawStart);
    const end = Number(rawEnd);
    if (!text || text.split(/\s+/).length !== 1) return false;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
    if (start + 0.08 < previousEnd) return false;
    previousEnd = end;
  }
  return true;
}

export function normalizeWordChunks(chunks) {
  let previousEnd = 0;
  return (Array.isArray(chunks) ? chunks : []).map((chunk) => {
    const start = Math.max(previousEnd, Number(chunk.timestamp[0]));
    const end = Math.max(start + 0.02, Number(chunk.timestamp[1]));
    previousEnd = end;
    return {
      ...chunk,
      text: String(chunk.text || "").trim(),
      timestamp: [start, end],
    };
  });
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
