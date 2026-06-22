let cancelled = false;

const send = (type, payload = {}) => self.postMessage({ type, ...payload });

function skinScore(data, width, height, rect) {
  const x0 = Math.floor(rect.x * width);
  const y0 = Math.floor(rect.y * height);
  const x1 = Math.ceil((rect.x + rect.width) * width);
  const y1 = Math.ceil((rect.y + rect.height) * height);
  let skin = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (r > 70 && g > 35 && b > 20 && r > g && r > b && max - min > 18 && Math.abs(r - g) > 8) skin++;
      count++;
    }
  }
  return count ? skin / count : 0;
}

function regionDifference(a, b, width, height, rect) {
  const x0 = Math.floor(rect.x * width);
  const y0 = Math.floor(rect.y * height);
  const x1 = Math.ceil((rect.x + rect.width) * width);
  const y1 = Math.ceil((rect.y + rect.height) * height);
  let total = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 5) {
    for (let x = x0; x < x1; x += 5) {
      const index = (y * width + x) * 4;
      total += Math.abs(a[index] - b[index])
        + Math.abs(a[index + 1] - b[index + 1])
        + Math.abs(a[index + 2] - b[index + 2]);
      count += 3;
    }
  }
  return count ? total / (count * 255) : 1;
}

function borderScore(data, width, height, rect) {
  const x0 = Math.floor(rect.x * width);
  const y0 = Math.floor(rect.y * height);
  const x1 = Math.min(width - 1, Math.ceil((rect.x + rect.width) * width));
  const y1 = Math.min(height - 1, Math.ceil((rect.y + rect.height) * height));
  const samples = [];
  for (let x = x0; x <= x1; x += 4) {
    samples.push((y0 * width + x) * 4, (y1 * width + x) * 4);
  }
  for (let y = y0; y <= y1; y += 4) {
    samples.push((y * width + x0) * 4, (y * width + x1) * 4);
  }
  if (!samples.length) return 0;
  let mean = 0;
  for (const index of samples) mean += (data[index] + data[index + 1] + data[index + 2]) / 3;
  mean /= samples.length;
  let variance = 0;
  for (const index of samples) {
    const value = (data[index] + data[index + 1] + data[index + 2]) / 3;
    variance += Math.abs(value - mean);
  }
  return Math.max(0, 1 - variance / samples.length / 90);
}

function overlap(a, b) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return (x * y) / Math.min(a.width * a.height, b.width * b.height);
}

function candidateRects() {
  const rects = [];
  const widths = [0.18, 0.24, 0.32, 0.45, 0.7, 0.96];
  const heights = [0.2, 0.28, 0.36, 0.48];
  const anchors = [0.02, 0.5, 0.98];
  for (const width of widths) {
    for (const height of heights) {
      if (width / height < 0.55 || width / height > 2.8) continue;
      for (const ax of anchors) {
        for (const ay of anchors) {
          rects.push({
            x: Math.max(0, Math.min(1 - width, ax === 0.5 ? 0.5 - width / 2 : ax === 0.98 ? 1 - width - 0.02 : 0.02)),
            y: Math.max(0, Math.min(1 - height, ay === 0.5 ? 0.5 - height / 2 : ay === 0.98 ? 1 - height - 0.02 : 0.02)),
            width,
            height,
          });
        }
      }
    }
  }
  return rects;
}

self.onmessage = (event) => {
  if (event.data?.type === "cancel") {
    cancelled = true;
    return;
  }
  if (event.data?.type !== "analyse") return;
  cancelled = false;
  const { frames, width, height, nativeFaces = [] } = event.data;
  try {
    send("stage", { stage: "analysing-faces", detail: "Analysing faces across sampled frames" });
    const rects = candidateRects();
    const scored = [];
    for (let rectIndex = 0; rectIndex < rects.length; rectIndex++) {
      if (cancelled) return send("cancelled");
      const rect = rects[rectIndex];
      const skin = frames.reduce((sum, frame) => sum + skinScore(frame, width, height, rect), 0) / frames.length;
      let difference = 0;
      for (let index = 1; index < frames.length; index++) {
        difference += regionDifference(frames[index - 1], frames[index], width, height, rect);
      }
      difference /= Math.max(1, frames.length - 1);
      const stable = Math.max(0, 1 - difference * 2.6);
      const border = borderScore(frames[0], width, height, rect);
      const nativeHits = nativeFaces.filter((face) => overlap(rect, face) > 0.45).length / Math.max(1, frames.length);
      const corner = (rect.x < 0.08 || rect.x + rect.width > 0.92) && (rect.y < 0.08 || rect.y + rect.height > 0.92) ? 0.08 : 0;
      const score = Math.min(1, skin * 3.2 * 0.35 + stable * 0.3 + border * 0.1 + nativeHits * 0.25 + corner);
      if (score > 0.24) scored.push({ crop: rect, confidence: score });
    }
    send("stage", { stage: "finding-fixed", detail: "Finding fixed webcam regions" });
    scored.sort((a, b) => b.confidence - a.confidence);
    const selected = [];
    for (const item of scored) {
      if (selected.every((existing) => overlap(existing.crop, item.crop) < 0.55)) selected.push(item);
      if (selected.length >= 4) break;
    }
    send("stage", { stage: "identifying-gameplay", detail: "Identifying gameplay and excluding webcam candidates" });
    const labelled = selected.map((candidate) => ({
      ...candidate,
      label: `${candidate.crop.y < 0.33 ? "Top" : candidate.crop.y > 0.55 ? "Bottom" : "Centre"}-${candidate.crop.x < 0.33 ? "left" : candidate.crop.x > 0.55 ? "right" : "centre"} candidate`,
    }));
    const best = labelled[0];
    send("result", {
      webcamCandidates: labelled,
      selectedWebcamCrop: best?.crop,
      gameplayCrop: { x: 0, y: 0, width: 1, height: 1 },
      confidence: best?.confidence || 0,
    });
  } catch (error) {
    send("error", { message: error instanceof Error ? error.message : String(error) });
  }
};
