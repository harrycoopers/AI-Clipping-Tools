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
    const result = await recognizer(message.audio, options);
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
