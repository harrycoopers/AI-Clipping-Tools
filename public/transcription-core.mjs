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

export function prepareAudioForRecognition(audio) {
  if (!(audio instanceof Float32Array) || !audio.length) return new Float32Array();

  const filtered = new Float32Array(audio.length);
  let previousInput = 0;
  let previousOutput = 0;
  let peak = 0;
  let sumSquares = 0;

  // Remove DC offset and very low-frequency rumble before recognition.
  for (let index = 0; index < audio.length; index += 1) {
    const input = Number.isFinite(audio[index]) ? audio[index] : 0;
    const output = input - previousInput + 0.995 * previousOutput;
    previousInput = input;
    previousOutput = output;
    filtered[index] = output;
    peak = Math.max(peak, Math.abs(output));
    sumSquares += output * output;
  }

  if (peak < 0.00001) return filtered;
  const rms = Math.sqrt(sumSquares / filtered.length);
  const rmsGain = rms > 0 ? 0.075 / rms : 1;
  const gain = Math.max(0.5, Math.min(6, rmsGain));

  for (let index = 0; index < filtered.length; index += 1) {
    // Soft limiting lets quiet dialogue be amplified even if the same clip
    // contains a loud impact, shout, or music peak.
    filtered[index] = Math.tanh(filtered[index] * gain);
  }
  return filtered;
}

export function detectSpeechRegions(audio, sampleRate = 16_000) {
  if (!(audio instanceof Float32Array) || !audio.length) return [];

  const frameSize = Math.max(1, Math.round(sampleRate * 0.03));
  const frameCount = Math.ceil(audio.length / frameSize);
  const levels = new Float32Array(frameCount);
  let peak = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * frameSize;
    const end = Math.min(audio.length, start + frameSize);
    let sumSquares = 0;
    for (let index = start; index < end; index += 1) {
      sumSquares += audio[index] * audio[index];
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
    levels[frame] = rms;
    peak = Math.max(peak, rms);
  }

  if (peak < 0.001) return [];
  const sorted = Array.from(levels).sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] || 0;
  // Use an adaptive floor instead of a large percentage of the loudest sound.
  // The latter discarded quiet words whenever a clip also contained a shout.
  const threshold = Math.max(0.00045, noiseFloor * 2.2);
  const active = Array.from(levels, (level) => level >= threshold);

  // Bridge very short dips inside speech and retain a small amount of context.
  const bridgeFrames = Math.round(0.28 / 0.03);
  let lastActive = -1;
  for (let frame = 0; frame < active.length; frame += 1) {
    if (!active[frame]) continue;
    if (lastActive >= 0 && frame - lastActive - 1 <= bridgeFrames) {
      for (let fill = lastActive + 1; fill < frame; fill += 1) active[fill] = true;
    }
    lastActive = frame;
  }

  const regions = [];
  const padFrames = Math.round(0.45 / 0.03);
  let startFrame = null;
  for (let frame = 0; frame <= active.length; frame += 1) {
    if (frame < active.length && active[frame] && startFrame == null) startFrame = frame;
    if ((frame === active.length || !active[frame]) && startFrame != null) {
      const endFrame = frame;
      const speechDuration = (endFrame - startFrame) * 0.03;
      if (speechDuration >= 0.12) {
        const speechStart = startFrame * frameSize / sampleRate;
        const speechEnd = endFrame * frameSize / sampleRate;
        regions.push({
          start: Math.max(0, (startFrame - padFrames) * frameSize / sampleRate),
          end: Math.min(audio.length / sampleRate, (endFrame + padFrames) * frameSize / sampleRate),
          speechStart,
          speechEnd,
        });
      }
      startFrame = null;
    }
  }

  // Fewer, larger regions are faster and give Whisper enough linguistic
  // context, while still excluding the long silences that cause hallucination.
  const merged = [];
  for (const region of regions) {
    const previous = merged.at(-1);
    if (previous && region.speechStart - previous.speechEnd <= 1.4) {
      previous.end = region.end;
      previous.speechEnd = region.speechEnd;
    } else {
      merged.push({ ...region });
    }
  }
  return merged;
}

export function offsetTimestampChunks(
  chunks,
  offset,
  regionEnd = Infinity,
  speechStart = offset,
  speechEnd = regionEnd
) {
  if (!Array.isArray(chunks)) return [];
  return chunks.map((chunk) => {
    const start = chunk?.timestamp?.[0];
    const end = chunk?.timestamp?.[1];
    return {
      ...chunk,
      timestamp: [
        Number.isFinite(start)
          ? Math.min(speechEnd + 0.18, Math.max(speechStart - 0.18, start + offset))
          : null,
        Number.isFinite(end)
          ? Math.min(regionEnd, Math.max(speechStart, end + offset))
          : null,
      ],
    };
  });
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
