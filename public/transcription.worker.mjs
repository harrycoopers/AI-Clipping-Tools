const TRANSFORMERS_CDN =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

let cancelled = false;
let transcriber = null;
let loadedKey = "";

const MODEL_IDS = {
  fast: "onnx-community/whisper-tiny",
  balanced: "onnx-community/whisper-base",
  accurate: "onnx-community/whisper-small",
};

function send(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

function normalizeError(error, backend) {
  const message = error instanceof Error ? error.message : String(error);
  if (/memory|allocation|buffer|out of bounds/i.test(message)) {
    return "The transcription model ran out of memory. Close other tabs or choose the Fast model.";
  }
  if (backend === "webgpu" && /webgpu|gpu|adapter|device|shader|pipeline/i.test(message)) {
    return "WebGPU could not run this model on this device. Retry with CPU/WASM mode.";
  }
  if (backend === "wasm" && /wasm|webassembly|onnx|backend|execution provider/i.test(message)) {
    return `CPU/WASM transcription could not start: ${message}`;
  }
  if (/fetch|network|download|404/i.test(message)) {
    return "The AI model could not be downloaded. Check the connection and retry.";
  }
  return message || "Transcription failed.";
}

function isMissingCrossAttentionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /cross[\s_-]?attentions?|output_attentions/i.test(message);
}

function expandChunksToWords(chunks) {
  const words = [];

  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    const text = String(chunk?.text || "").trim();
    if (!text) continue;

    const parts = text.split(/\s+/).filter(Boolean);
    const start = Number(chunk?.timestamp?.[0]);
    const end = Number(chunk?.timestamp?.[1]);
    const hasTimestamp = Number.isFinite(start) && Number.isFinite(end) && end > start;

    for (let index = 0; index < parts.length; index += 1) {
      const timestamp = hasTimestamp
        ? [
            start + ((end - start) * index) / parts.length,
            start + ((end - start) * (index + 1)) / parts.length,
          ]
        : null;
      words.push({ text: parts[index], timestamp });
    }
  }

  return words;
}

async function loadPipeline(model, requestedDevice, forceReload = false) {
  const { pipeline, env } = await import(TRANSFORMERS_CDN);
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  // GitHub Pages cannot provide the cross-origin isolation required by
  // multi-threaded WASM. A single thread is slower but works reliably.
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
  }

  const modelId = MODEL_IDS[model] || MODEL_IDS.balanced;
  const device = requestedDevice === "webgpu" ? "webgpu" : "wasm";
  const key = `${modelId}:${device}`;
  if (!forceReload && transcriber && loadedKey === key) return transcriber;

  transcriber = null;
  loadedKey = "";
  send("stage", { stage: "model", status: "active", detail: `Loading ${model} model on ${device.toUpperCase()}` });

  const options = {
    progress_callback: (event) => {
      if (cancelled) return;
      const progress = Number.isFinite(event?.progress) ? Math.round(event.progress) : null;
      send("model-progress", {
        progress,
        file: event?.file || event?.name || "",
        status: event?.status || "downloading",
      });
    },
  };
  if (device === "webgpu") {
    options.device = "webgpu";
    options.dtype = { encoder_model: "fp16", decoder_model_merged: "q4" };
  }
  // For CPU, omit `device` and `dtype`: Transformers.js officially defaults
  // to its broadly-compatible q8 WASM path in browsers.

  transcriber = await pipeline("automatic-speech-recognition", modelId, options);
  loadedKey = key;
  send("stage", { stage: "model", status: "complete", detail: "Model ready" });
  return transcriber;
}

self.onmessage = async (event) => {
  const message = event.data;
  if (message?.type === "cancel") {
    cancelled = true;
    send("cancelled");
    return;
  }
  if (message?.type !== "transcribe") return;

  cancelled = false;
  let device = message.device === "webgpu" ? "webgpu" : "wasm";
  try {
    let recognizer;
    try {
      recognizer = await loadPipeline(message.model, device, message.forceReload);
    } catch (error) {
      if (device === "webgpu" && message.allowFallback !== false) {
        send("device-fallback", { detail: "WebGPU unavailable for this model; retrying with CPU/WASM." });
        device = "wasm";
        recognizer = await loadPipeline(message.model, device, true);
      } else {
        throw error;
      }
    }
    if (cancelled) return send("cancelled");

    send("stage", { stage: "transcription", status: "active", detail: "Recognising speech" });
    const options = {
      return_timestamps: "word",
      // Whisper derives word boundaries from decoder cross-attention. Request
      // those outputs explicitly; otherwise generate() can omit them even when
      // the selected ONNX model supports word timestamps.
      output_attentions: true,
      chunk_length_s: message.model === "accurate" ? 20 : 30,
      stride_length_s: 5,
      task: "transcribe",
      language: message.language === "auto" ? null : message.language,
      callback_function: (items) => {
        if (cancelled) return;
        const last = Array.isArray(items) ? items.at(-1) : null;
        send("transcription-progress", {
          text: last?.text || "",
          timestamp: last?.timestamp || null,
        });
      },
    };
    let result;
    try {
      result = await recognizer(message.audio, options);
    } catch (error) {
      if (!isMissingCrossAttentionError(error)) throw error;

      // Some optimized decoder exports do not expose cross-attention tensors.
      // Segment timestamps use Whisper's timestamp tokens instead, so retain
      // usable timing data and distribute each segment across its words.
      send("stage", {
        stage: "transcription",
        status: "active",
        detail: "Word timing unavailable; using segment timing",
      });
      const segmentOptions = { ...options };
      delete segmentOptions.output_attentions;
      result = await recognizer(message.audio, {
        ...segmentOptions,
        return_timestamps: true,
      });
      result = {
        ...result,
        chunks: expandChunksToWords(result?.chunks),
      };
    }
    if (cancelled) return send("cancelled");
    send("stage", { stage: "transcription", status: "complete", detail: "Speech recognised" });
    send("result", {
      text: result?.text || "",
      chunks: Array.isArray(result?.chunks) ? result.chunks : [],
      device,
    });
  } catch (error) {
    if (!cancelled) {
      send("error", {
        message: normalizeError(error, device),
        backend: device,
        technical: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
