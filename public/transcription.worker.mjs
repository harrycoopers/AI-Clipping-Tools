import {
  detectSpeechRegions,
  isMissingCrossAttentionError,
  normalizeTranscriptionError,
  offsetTimestampChunks,
  pipelineRuntimeOptions,
  prepareAudioForRecognition,
  recoverWordTimestamps,
} from "./transcription-core.mjs?v=6";

const workerUrl = new URL(self.location.href);
const testModule = workerUrl.searchParams.get("testTransformers");
const TRANSFORMERS_CDN =
  testModule && ["localhost", "127.0.0.1"].includes(workerUrl.hostname)
    ? new URL(testModule, workerUrl).href
    : "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

let cancelled = false;
let transcriber = null;
let loadedKey = "";

const MODEL_IDS = {
  // These Transformers.js exports include the decoder cross-attention outputs
  // required by Whisper's DTW-based token/word timestamp extraction.
  fast: "Xenova/whisper-tiny",
  balanced: "Xenova/whisper-base",
  accurate: "Xenova/whisper-small",
};

const ENGLISH_MODEL_IDS = {
  fast: "Xenova/whisper-tiny.en",
  balanced: "Xenova/whisper-base.en",
  accurate: "Xenova/whisper-small.en",
};

function isEnglishOnlyLanguage(language) {
  return language === "english" || language === "en";
}

function createRecognitionOptions(message, progressCallback) {
  const options = {
    return_timestamps: "word",
    chunk_length_s: message.model === "accurate" ? 20 : 30,
    stride_length_s: 5,
    // Avoid turning sustained background sounds into caption text.
    no_speech_threshold: 0.82,
    logprob_threshold: -1.2,
    compression_ratio_threshold: 2.4,
    condition_on_prev_tokens: false,
    do_sample: false,
    temperature: 0,
    repetition_penalty: 1.08,
    num_beams: message.model === "accurate" ? 5 : 1,
    early_stopping: message.model === "accurate",
    callback_function: progressCallback,
  };

  // English-only Whisper exports reject task/language generation arguments.
  // Multilingual exports need them to transcribe in the selected language.
  if (!isEnglishOnlyLanguage(message.language)) {
    options.task = "transcribe";
    options.language = message.language === "auto" ? null : message.language;
  }
  return options;
}

function send(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

// Lets the editor distinguish a successfully evaluated module worker from a
// model/network error that happens later during transcription.
send("ready", { workerVersion: 11 });

async function loadPipeline(model, requestedDevice, language, forceReload = false) {
  const { pipeline, env } = await import(TRANSFORMERS_CDN);
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  // GitHub Pages cannot provide the cross-origin isolation required by
  // multi-threaded WASM. A single thread is slower but works reliably.
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
  }

  const englishOnly = isEnglishOnlyLanguage(language);
  const modelIds = englishOnly ? ENGLISH_MODEL_IDS : MODEL_IDS;
  const modelId = modelIds[model] || modelIds.balanced;
  const device = requestedDevice === "webgpu" ? "webgpu" : "wasm";
  const key = `${modelId}:${device}`;
  if (!forceReload && transcriber && loadedKey === key) return transcriber;

  transcriber = null;
  loadedKey = "";
  send("stage", { stage: "model", status: "active", detail: `Loading ${model} model on ${device.toUpperCase()}` });

  const options = pipelineRuntimeOptions(device, (event) => {
      if (cancelled) return;
      const progress = Number.isFinite(event?.progress) ? Math.round(event.progress) : null;
      send("model-progress", {
        progress,
        file: event?.file || event?.name || "",
        status: event?.status || "downloading",
      });
    });

  transcriber = await pipeline("automatic-speech-recognition", modelId, options);
  loadedKey = key;
  send("stage", { stage: "model", status: "complete", detail: "Model ready" });
  return transcriber;
}

async function recognizeWithTimestamps(recognizer, audio, options) {
  try {
    const result = await recognizer(audio, options);
    const recovered = recoverWordTimestamps(result, audio.length / 16_000);
    if (!recovered.chunks.length) {
      throw new Error("The transcription model returned text without usable timestamp boundaries.");
    }
    return {
      ...result,
      chunks: recovered.chunks,
      word_timestamps: true,
      word_timing_quality: recovered.quality,
    };
  } catch (error) {
    if (isMissingCrossAttentionError(error)) {
      throw new Error("This cached Whisper model cannot produce word timestamps. Retry to download the timestamp-compatible model.");
    }
    throw error;
  }
}

async function transcribeSpeechRegions(recognizer, audio, options) {
  const sampleRate = 16_000;
  const preparedAudio = prepareAudioForRecognition(audio);
  const regions = detectSpeechRegions(preparedAudio, sampleRate);
  send("speech-regions", {
    count: regions.length,
    duration: audio.length / sampleRate,
  });
  if (!regions.length) {
    return { text: "", chunks: [], word_timestamps: true, word_timing_quality: "word" };
  }

  const combined = [];
  const text = [];
  let timingQuality = "word";
  for (let index = 0; index < regions.length; index += 1) {
    if (cancelled) break;
    const region = regions[index];
    const startSample = Math.max(0, Math.floor(region.start * sampleRate));
    const endSample = Math.min(audio.length, Math.ceil(region.end * sampleRate));
    const regionAudio = preparedAudio.slice(startSample, endSample);
    send("transcription-progress", {
      text: "",
      timestamp: [region.start, region.end],
      region: index + 1,
      regionCount: regions.length,
    });
    const result = await recognizeWithTimestamps(recognizer, regionAudio, options);
    combined.push(...offsetTimestampChunks(
      result.chunks,
      region.start,
      region.end,
      region.speechStart,
      region.speechEnd
    ));
    if (result.text?.trim()) text.push(result.text.trim());
    if (result.word_timing_quality !== "word") timingQuality = result.word_timing_quality;
  }
  return {
    text: text.join(" ").trim(),
    chunks: combined,
    word_timestamps: true,
    word_timing_quality: timingQuality,
  };
}

self.onmessage = async (event) => {
  const message = event.data;
  if (message?.type === "cancel") {
    cancelled = true;
    send("cancelled");
    return;
  }
  if (message?.type !== "transcribe") return;

  // Repeat the handshake for each job. Reused workers may have emitted their
  // module-startup message before a new per-job listener was attached.
  send("ready", { workerVersion: 11 });

  cancelled = false;
  let device = message.device === "webgpu" ? "webgpu" : "wasm";
  try {
    let recognizer;
    try {
      recognizer = await loadPipeline(message.model, device, message.language, message.forceReload);
    } catch (error) {
      if (device === "webgpu" && message.allowFallback !== false) {
        send("device-fallback", { detail: "WebGPU unavailable for this model; retrying with CPU/WASM." });
        device = "wasm";
        recognizer = await loadPipeline(message.model, device, message.language, true);
      } else {
        throw error;
      }
    }
    if (cancelled) return send("cancelled");

    send("stage", { stage: "transcription", status: "active", detail: "Recognising speech" });
    const options = createRecognitionOptions(message, (items) => {
        if (cancelled) return;
        const last = Array.isArray(items) ? items.at(-1) : null;
        send("transcription-progress", {
          text: last?.text || "",
          timestamp: last?.timestamp || null,
        });
      });
    let result;
    try {
      result = await transcribeSpeechRegions(recognizer, message.audio, options);
    } catch (error) {
      if (device !== "webgpu" || message.allowFallback === false) throw error;

      send("device-fallback", {
        detail: "WebGPU word timing failed; retrying with the CPU/WASM timestamp model.",
      });
      device = "wasm";
      recognizer = await loadPipeline(message.model, device, message.language, true);
      result = await transcribeSpeechRegions(recognizer, message.audio, options);
    }
    if (cancelled) return send("cancelled");
    send("stage", { stage: "transcription", status: "complete", detail: "Speech recognised" });
    send("result", {
      text: result?.text || "",
      chunks: Array.isArray(result?.chunks) ? result.chunks : [],
      device,
      wordTimestamps: result?.word_timestamps === true,
      wordTimingQuality: result?.word_timing_quality || "none",
    });
  } catch (error) {
    if (!cancelled) {
      send("error", {
        message: normalizeTranscriptionError(error, device),
        backend: device,
        technical: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
