"use client";

import { useEffect, useRef, useState } from "react";
import { Brain, Check, Copy, Download, Eye, EyeOff, Layers, Plus, RefreshCw, Scissors, Trash2, Upload, X } from "lucide-react";
import { asset } from "@/lib/basePath";
import {
  applyLayoutPreset,
  clampRect,
  confidenceLevel,
  makeRegion,
  type LayoutType,
  type DetectionResult,
  type PortraitGamingLayout,
  type Rect,
  type VideoRegion,
  type WebcamCandidate,
} from "@/lib/portrait-layout";

type DetectionStage =
  | "loading-model"
  | "extracting-frames"
  | "analysing-faces"
  | "finding-fixed"
  | "identifying-gameplay"
  | "creating-layout"
  | "preparing-preview";

const STAGE_LABELS: Record<DetectionStage, string> = {
  "loading-model": "Loading detection model",
  "extracting-frames": "Extracting sample frames",
  "analysing-faces": "Analysing faces",
  "finding-fixed": "Finding fixed webcam regions",
  "identifying-gameplay": "Identifying gameplay",
  "creating-layout": "Creating portrait layout",
  "preparing-preview": "Preparing preview",
};

const LAYOUTS: [LayoutType, string][] = [
  ["quarter-webcam-top", "Quarter webcam top"],
  ["quarter-webcam-bottom", "Quarter webcam bottom"],
  ["webcam-top-half", "Webcam top half"],
  ["webcam-bottom-half", "Webcam bottom half"],
  ["floating-webcam", "Floating webcam"],
  ["normal-camera", "Normal camera"],
  ["gameplay-only", "Gameplay only"],
  ["blurred-background", "Blurred background"],
  ["custom-split", "Custom split"],
  ["manual", "Manual layout"],
];

export default function PortraitLayoutPanel({
  layout,
  onChange,
  video,
}: {
  layout: PortraitGamingLayout;
  onChange: (layout: PortraitGamingLayout) => void;
  video: { url: string; duration: number; w: number; h: number } | null;
}) {
  const [detecting, setDetecting] = useState(false);
  const [stage, setStage] = useState<DetectionStage | null>(null);
  const [error, setError] = useState("");
  const [selectedRegionId, setSelectedRegionId] = useState("webcam");
  const [candidateImages, setCandidateImages] = useState<string[]>([]);
  const [layoutPresets, setLayoutPresets] = useState<Array<{ id: string; name: string; layout: PortraitGamingLayout }>>([]);
  const workerRef = useRef<Worker | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("captionforge-portrait-presets-v1");
      if (saved) setLayoutPresets(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem("captionforge-portrait-presets-v1", JSON.stringify(layoutPresets)); } catch {}
  }, [layoutPresets]);

  function patch(patch: Partial<PortraitGamingLayout>) {
    onChange({ ...layout, ...patch });
  }

  function patchRegion(id: string, patch: Partial<VideoRegion>) {
    onChange({
      ...layout,
      regions: layout.regions.map((region) => region.id === id ? {
        ...region,
        ...patch,
        sourceCrop: patch.sourceCrop ? clampRect(patch.sourceCrop) : region.sourceCrop,
        destination: patch.destination ? clampRect(patch.destination) : region.destination,
      } : region),
    });
  }

  async function runDetection() {
    if (!video || detecting) return;
    setDetecting(true);
    setError("");
    cancelRef.current = false;
    setStage("loading-model");
    const worker = new Worker(asset("/portrait-detection.worker.mjs?v=1"), { type: "module" });
    workerRef.current = worker;
    const sampleVideo = document.createElement("video");
    sampleVideo.src = video.url;
    sampleVideo.muted = true;
    sampleVideo.preload = "auto";
    sampleVideo.playsInline = true;
    const canvas = document.createElement("canvas");
    const width = 320;
    const height = Math.max(120, Math.round(width * video.h / video.w));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    try {
      if (!ctx) throw new Error("Canvas analysis is unavailable in this browser.");
      await new Promise<void>((resolve, reject) => {
        if (sampleVideo.readyState >= HTMLMediaElement.HAVE_METADATA) return resolve();
        sampleVideo.onloadedmetadata = () => resolve();
        sampleVideo.onerror = () => reject(new Error("The video could not be opened for detection."));
      });
      if (cancelRef.current) return;
      setStage("extracting-frames");
      const sampleCount = video.duration > 300 ? 12 : 9;
      const times = Array.from({ length: sampleCount }, (_, index) =>
        Math.min(video.duration - 0.05, Math.max(0, video.duration * ((index + 0.5) / sampleCount)))
      );
      const frames: Uint8ClampedArray[] = [];
      const nativeFaces: Rect[] = [];
      const nativeFaceSamples: Array<{ time: number; faces: Rect[] }> = [];
      const firstFrameCanvas = document.createElement("canvas");
      firstFrameCanvas.width = width;
      firstFrameCanvas.height = height;
      const firstCtx = firstFrameCanvas.getContext("2d");
      const FaceDetectorCtor = (window as unknown as {
        FaceDetector?: new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => {
          detect: (source: CanvasImageSource) => Promise<Array<{ boundingBox: DOMRectReadOnly }>>;
        };
      }).FaceDetector;
      const faceDetector = FaceDetectorCtor ? new FaceDetectorCtor({ fastMode: true, maxDetectedFaces: 8 }) : null;

      for (let index = 0; index < times.length; index++) {
        if (cancelRef.current) return;
        await seekVideo(sampleVideo, times[index]);
        ctx.drawImage(sampleVideo, 0, 0, width, height);
        if (index === 0) firstCtx?.drawImage(sampleVideo, 0, 0, width, height);
        frames.push(ctx.getImageData(0, 0, width, height).data);
        if (faceDetector) {
          try {
            const faces = await faceDetector.detect(canvas);
            const normalizedFaces: Rect[] = [];
            for (const face of faces) {
              const normalized = {
                x: face.boundingBox.x / width,
                y: face.boundingBox.y / height,
                width: face.boundingBox.width / width,
                height: face.boundingBox.height / height,
              };
              nativeFaces.push(normalized);
              normalizedFaces.push(normalized);
            }
            nativeFaceSamples.push({ time: times[index], faces: normalizedFaces });
          } catch {}
        }
      }
      if (cancelRef.current) return;

      const result = await new Promise<{
        webcamCandidates: WebcamCandidate[];
        selectedWebcamCrop?: Rect;
        gameplayCrop: Rect;
        confidence: number;
      }>((resolve, reject) => {
        worker.onmessage = (event) => {
          if (event.data.type === "stage") setStage(event.data.stage);
          if (event.data.type === "result") resolve(event.data);
          if (event.data.type === "error") reject(new Error(event.data.message));
          if (event.data.type === "cancelled") reject(new DOMException("Detection cancelled", "AbortError"));
        };
        worker.onerror = () => reject(new Error("The detection worker could not start."));
        worker.postMessage({ type: "analyse", frames, width, height, nativeFaces });
      });
      if (cancelRef.current) return;
      setStage("creating-layout");
      const level = confidenceLevel(result.confidence);
      const detection: DetectionResult = {
        webcamCandidates: result.webcamCandidates,
        selectedWebcamCrop: result.selectedWebcamCrop,
        gameplayCrop: result.gameplayCrop,
        confidenceLevel: level,
        confirmed: false,
        message: result.selectedWebcamCrop
          ? `${level[0].toUpperCase() + level.slice(1)} confidence: a fixed webcam candidate was found.`
          : "No reliable webcam region was detected. You can retry detection or select the webcam area manually.",
      };
      let next: PortraitGamingLayout = { ...layout, enabled: true, detection };
      if (result.selectedWebcamCrop) {
        const webcamCrop = result.selectedWebcamCrop;
        const trackingKeyframes = nativeFaceSamples.flatMap((sample) => {
          const face = sample.faces.find((candidate) => rectOverlap(candidate, webcamCrop) > .4);
          if (!face) return [];
          const faceCentreX = face.x + face.width / 2;
          const faceCentreY = face.y + face.height / 2;
          return [{
            time: sample.time,
            panX: Math.max(-1, Math.min(1, ((faceCentreX - webcamCrop.x) / webcamCrop.width - .5) * 1.2)),
            panY: Math.max(-1, Math.min(1, ((faceCentreY - webcamCrop.y) / webcamCrop.height - .5) * 1.2)),
          }];
        });
        next = {
          ...applyLayoutPreset(next, "quarter-webcam-bottom", 0.75),
          detection,
          trackingKeyframes,
          regions: applyLayoutPreset(next, "quarter-webcam-bottom", 0.75).regions.map((region) =>
            region.type === "webcam" ? { ...region, sourceCrop: result.selectedWebcamCrop! }
              : region.type === "gameplay" ? { ...region, sourceCrop: result.gameplayCrop } : region
          ),
        };
      } else {
        next = applyLayoutPreset(next, "gameplay-only", 0.75);
        next.detection = detection;
      }
      const images = result.webcamCandidates.map((candidate) =>
        cropDataUrl(firstFrameCanvas, candidate.crop)
      );
      setCandidateImages(images);
      setStage("preparing-preview");
      onChange(next);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "Detection failed.");
      }
    } finally {
      worker.terminate();
      workerRef.current = null;
      sampleVideo.removeAttribute("src");
      sampleVideo.load();
      setDetecting(false);
      setStage(null);
    }
  }

  function cancelDetection() {
    cancelRef.current = true;
    workerRef.current?.postMessage({ type: "cancel" });
    workerRef.current?.terminate();
    workerRef.current = null;
    setDetecting(false);
    setStage(null);
  }

  function selectCandidate(candidate: WebcamCandidate) {
    const next = layout.regions.some((region) => region.type === "webcam")
      ? {
          ...layout,
          regions: layout.regions.map((region) => region.type === "webcam" ? { ...region, sourceCrop: candidate.crop } : region),
        }
      : applyLayoutPreset({
          ...layout,
          detection: { ...layout.detection!, selectedWebcamCrop: candidate.crop },
        }, "quarter-webcam-bottom", layout.splitRatio);
    onChange({
      ...next,
      detection: next.detection ? { ...next.detection, selectedWebcamCrop: candidate.crop, confirmed: false } : undefined,
    });
  }

  const selectedRegion = layout.regions.find((region) => region.id === selectedRegionId) || layout.regions[0];

  return (
    <Section title="Portrait Gaming Layout" icon={<Scissors size={14} color="#FFCA3A" />}>
      <label style={row}>
        <input type="checkbox" checked={layout.enabled} onChange={(event) => patch({ enabled: event.target.checked })} />
        <span>Convert landscape clip to portrait</span>
      </label>
      {layout.enabled && (
        <>
          <label style={row}>
            <input type="checkbox" checked readOnly />
            <span>Automatically detect webcam and gameplay</span>
          </label>
          <button style={primaryButton} disabled={!video || detecting} onClick={() => void runDetection()}>
            <Brain size={14} /> AI Detect Layout
          </button>
          {detecting && (
            <div style={statusBox}>
              <div>{stage ? STAGE_LABELS[stage] : "Starting detection"}</div>
              <button style={smallButton} onClick={cancelDetection}><X size={12} /> Cancel</button>
            </div>
          )}
          {error && <div style={{ ...statusBox, color: "#FF9ABB" }}>{error}<button style={smallButton} onClick={() => void runDetection()}><RefreshCw size={12} /> Retry</button></div>}
          {layout.detection && (
            <div style={statusBox}>
              <strong>{layout.detection.message}</strong>
              {layout.detection.webcamCandidates.length > 1 && <div>We found multiple possible webcam areas. Select the correct one.</div>}
              {layout.detection.webcamCandidates.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 6, marginTop: 8 }}>
                  {layout.detection.webcamCandidates.map((candidate, index) => (
                    <button key={index} style={candidateButton} onClick={() => selectCandidate(candidate)}>
                      {candidateImages[index] && <img src={candidateImages[index]} alt={candidate.label} style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", borderRadius: 5 }} />}
                      <span>{candidate.label} · {Math.round(candidate.confidence * 100)}%</span>
                    </button>
                  ))}
                </div>
              )}
              {video && <SourceRegionReview videoUrl={video.url} layout={layout} onChange={onChange} />}
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {!layout.detection.confirmed && <button style={primaryButton} onClick={() => patch({ detection: { ...layout.detection!, confirmed: true } })}><Check size={13} /> Accept AI layout</button>}
                <button style={smallButton} onClick={() => void runDetection()}><RefreshCw size={12} /> Run detection again</button>
                <button style={smallButton} onClick={() => onChange(applyLayoutPreset({ ...layout, detection: { ...layout.detection!, selectedWebcamCrop: undefined, confirmed: true } }, "gameplay-only", layout.splitRatio))}>Remove webcam</button>
                <button style={smallButton} onClick={() => patch({ layout: "manual" })}>AI result incorrect? Adjust detection</button>
              </div>
            </div>
          )}

          <Field label="Output resolution">
            <select style={input} value={`${layout.outputWidth}x${layout.outputHeight}`} onChange={(event) => {
              const [outputWidth, outputHeight] = event.target.value.split("x").map(Number);
              patch({ outputWidth, outputHeight });
            }}>
              <option value="720x1280">720 × 1280</option>
              <option value="1080x1920">1080 × 1920</option>
              <option value="1440x2560">1440 × 2560</option>
            </select>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <Field label="Custom width"><input style={input} type="number" min={360} max={2160} step={2} value={layout.outputWidth} onChange={(event) => patch({ outputWidth: Math.max(360, Number(event.target.value)) })} /></Field>
            <Field label="Custom height"><input style={input} type="number" min={640} max={3840} step={2} value={layout.outputHeight} onChange={(event) => patch({ outputHeight: Math.max(640, Number(event.target.value)) })} /></Field>
          </div>
          <Field label="Layout">
            <select style={input} value={layout.layout} onChange={(event) => onChange(applyLayoutPreset(layout, event.target.value as LayoutType, layout.splitRatio))}>
              {LAYOUTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Webcam framing">
            <select style={input} value={layout.webcamCropMode} onChange={(event) => {
              const webcamCropMode = event.target.value as PortraitGamingLayout["webcamCropMode"];
              const zoom = webcamCropMode === "face-centred" ? 2 : webcamCropMode === "upper-body" ? 1.35 : 1;
              onChange({
                ...layout,
                webcamCropMode,
                regions: layout.regions.map((region) => region.type === "webcam" && webcamCropMode !== "custom" ? { ...region, zoom, panX: 0, panY: 0 } : region),
              });
            }}>
              <option value="full">Full webcam frame</option>
              <option value="face-centred">Face centred</option>
              <option value="upper-body">Upper body</option>
              <option value="keep-border">Keep webcam border</option>
              <option value="custom">Custom</option>
            </select>
          </Field>
          <Field label={`Gameplay ${Math.round(layout.splitRatio * 100)}% / Webcam ${Math.round((1 - layout.splitRatio) * 100)}%`}>
            <input type="range" min={50} max={85} value={layout.splitRatio * 100} onChange={(event) => onChange(applyLayoutPreset(layout, layout.layout, Number(event.target.value) / 100))} />
          </Field>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            <button style={smallButton} onClick={() => onChange(applyLayoutPreset(layout, "quarter-webcam-top", layout.splitRatio))}>Flip webcam top</button>
            <button style={smallButton} onClick={() => onChange(applyLayoutPreset(layout, "quarter-webcam-bottom", layout.splitRatio))}>Flip webcam bottom</button>
            <button style={smallButton} onClick={() => onChange(applyLayoutPreset(layout, "floating-webcam", layout.splitRatio))}>Use floating webcam</button>
            <button style={smallButton} onClick={() => patch({ layout: "manual" })}>Convert preset to manual</button>
          </div>

          <Field label="Background">
            <select style={input} value={layout.backgroundType} onChange={(event) => patch({ backgroundType: event.target.value as PortraitGamingLayout["backgroundType"] })}>
              <option value="black">Black</option><option value="solid">Solid colour</option>
              <option value="gradient">Gradient</option><option value="blurred-gameplay">Blurred gameplay</option>
              <option value="blurred-webcam">Blurred webcam</option>
            </select>
          </Field>
          <Field label="Background colour"><input style={input} type="color" value={layout.backgroundColour} onChange={(event) => patch({ backgroundColour: event.target.value })} /></Field>
          <Field label="Safe areas">
            <select style={input} value={layout.safeArea} onChange={(event) => patch({ safeArea: event.target.value as PortraitGamingLayout["safeArea"] })}>
              <option value="none">None</option><option value="tiktok">TikTok</option><option value="youtube">YouTube Shorts</option><option value="instagram">Instagram Reels</option>
            </select>
          </Field>
          <label style={row}><input type="checkbox" checked={layout.snapping} onChange={(event) => patch({ snapping: event.target.checked })} /> Snapping and guides</label>
          <label style={row} title="Tracking is applied only when a browser face detector is available.">
            <input type="checkbox" checked={layout.trackingEnabled} disabled={!layout.detection?.selectedWebcamCrop} onChange={(event) => patch({ trackingEnabled: event.target.checked })} />
            Track streamer inside webcam crop
          </label>

          <div style={{ marginTop: 12, fontWeight: 800, fontSize: 12 }}>Saved layouts</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>
            <button style={smallButton} onClick={() => {
              const name = window.prompt("Layout preset name", "Gaming portrait");
              if (name) setLayoutPresets((presets) => [...presets, { id: `${Date.now()}`, name, layout: structuredClone(layout) }]);
            }}><Plus size={12} /> Save as new</button>
            <button style={smallButton} onClick={() => {
              const blob = new Blob([JSON.stringify({ kind: "captionforge-portrait-layouts", presets: layoutPresets }, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url; anchor.download = "captionforge-portrait-layouts.json"; anchor.click();
              setTimeout(() => URL.revokeObjectURL(url), 30000);
            }}><Download size={12} /> Export JSON</button>
            <label style={smallButton}><Upload size={12} /> Import JSON<input type="file" accept=".json" hidden onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              file.text().then((text) => {
                const parsed = JSON.parse(text);
                if (parsed.kind === "captionforge-portrait-layouts" && Array.isArray(parsed.presets)) setLayoutPresets(parsed.presets);
              }).catch(() => setError("That layout preset file is invalid."));
            }} /></label>
          </div>
          {layoutPresets.map((preset) => <div key={preset.id} style={{ display: "flex", gap: 5, marginTop: 5 }}>
            <button style={{ ...smallButton, flex: 1 }} onClick={() => onChange(structuredClone(preset.layout))}>{preset.name}</button>
            <button style={smallButton} title="Update preset" onClick={() => setLayoutPresets((presets) => presets.map((item) => item.id === preset.id ? { ...item, layout: structuredClone(layout) } : item))}><RefreshCw size={12} /></button>
            <button style={smallButton} title="Duplicate preset" onClick={() => setLayoutPresets((presets) => [...presets, { ...preset, id: `${Date.now()}`, name: `${preset.name} copy` }])}><Copy size={12} /></button>
            <button style={smallButton} title="Delete preset" onClick={() => setLayoutPresets((presets) => presets.filter((item) => item.id !== preset.id))}><Trash2 size={12} /></button>
          </div>)}

          <div style={{ marginTop: 12, fontWeight: 800, fontSize: 12 }}>Layers</div>
          <div style={{ display: "grid", gap: 5, marginTop: 7 }}>
            {[...layout.regions].sort((a, b) => b.zIndex - a.zIndex).map((region) => (
              <button key={region.id} style={{ ...candidateButton, borderColor: selectedRegion?.id === region.id ? "#FFCA3A" : "#352D47" }} onClick={() => setSelectedRegionId(region.id)}>
                <Layers size={12} /> {region.name}
                <span style={{ marginLeft: "auto" }}>{region.visible ? <Eye size={12} /> : <EyeOff size={12} />}</span>
              </button>
            ))}
          </div>
          <button style={smallButton} onClick={() => {
            const name = window.prompt("Name this video region", "Additional region") || "Additional region";
            const id = `region-${Date.now()}`;
            onChange({ ...layout, layout: "manual", regions: [...layout.regions, makeRegion(id, name, "additional", { x: .25, y: .25, width: .25, height: .25 }, { x: .6, y: .4, width: .32, height: .2 }, layout.regions.length + 1)] });
            setSelectedRegionId(id);
          }}><Plus size={12} /> Add Video Region</button>

          {selectedRegion && <RegionEditor region={selectedRegion} onPatch={(patchValue) => patchRegion(selectedRegion.id, patchValue)} onDelete={() => onChange({ ...layout, regions: layout.regions.filter((region) => region.id !== selectedRegion.id) })} onDuplicate={() => {
            const copy = { ...selectedRegion, id: `region-${Date.now()}`, name: `${selectedRegion.name} copy`, zIndex: layout.regions.length + 1 };
            onChange({ ...layout, regions: [...layout.regions, copy] });
          }} />}
        </>
      )}
    </Section>
  );
}

function RegionEditor({ region, onPatch, onDelete, onDuplicate }: {
  region: VideoRegion;
  onPatch: (patch: Partial<VideoRegion>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const patchRect = (key: "sourceCrop" | "destination", field: keyof Rect, value: number) =>
    onPatch({ [key]: { ...region[key], [field]: value } });
  return (
    <div style={{ ...statusBox, marginTop: 10 }}>
      <input style={input} value={region.name} onChange={(event) => onPatch({ name: event.target.value })} />
      <div style={{ fontSize: 11, color: "#A99FC2" }}>Source crop</div>
      <RectInputs rect={region.sourceCrop} onChange={(field, value) => patchRect("sourceCrop", field, value)} />
      <div style={{ fontSize: 11, color: "#A99FC2" }}>Destination</div>
      <RectInputs rect={region.destination} onChange={(field, value) => patchRect("destination", field, value)} />
      <Field label="Fit mode"><select style={input} value={region.fitMode} onChange={(event) => onPatch({ fitMode: event.target.value as VideoRegion["fitMode"] })}><option>fill</option><option>fit</option><option>crop</option><option>stretch</option></select></Field>
      <Field label={`Zoom ${region.zoom.toFixed(2)}×`}><input type="range" min={1} max={4} step={.05} value={region.zoom} onChange={(event) => onPatch({ zoom: Number(event.target.value) })} /></Field>
      <Field label="Pan X"><input type="range" min={-1} max={1} step={.02} value={region.panX} onChange={(event) => onPatch({ panX: Number(event.target.value) })} /></Field>
      <Field label="Pan Y"><input type="range" min={-1} max={1} step={.02} value={region.panY} onChange={(event) => onPatch({ panY: Number(event.target.value) })} /></Field>
      <Field label="Rotation"><input type="number" style={input} value={region.rotation} onChange={(event) => onPatch({ rotation: Number(event.target.value) })} /></Field>
      <Field label="Layer order"><input type="number" style={input} value={region.zIndex} onChange={(event) => onPatch({ zIndex: Number(event.target.value) })} /></Field>
      <Field label="Opacity"><input type="range" min={0} max={1} step={.01} value={region.opacity} onChange={(event) => onPatch({ opacity: Number(event.target.value) })} /></Field>
      <Field label="Border radius"><input type="range" min={0} max={.2} step={.005} value={region.borderRadius} onChange={(event) => onPatch({ borderRadius: Number(event.target.value) })} /></Field>
      <Field label="Border width"><input type="range" min={0} max={.03} step={.001} value={region.borderWidth} onChange={(event) => onPatch({ borderWidth: Number(event.target.value) })} /></Field>
      <Field label="Border colour"><input type="color" style={input} value={region.borderColour} onChange={(event) => onPatch({ borderColour: event.target.value })} /></Field>
      <label style={row}><input type="checkbox" checked={region.shadowEnabled} onChange={(event) => onPatch({ shadowEnabled: event.target.checked })} /> Shadow</label>
      <label style={row}><input type="checkbox" checked={region.locked} onChange={(event) => onPatch({ locked: event.target.checked })} /> Lock</label>
      <label style={row}><input type="checkbox" checked={region.visible} onChange={(event) => onPatch({ visible: event.target.checked })} /> Visible</label>
      <div style={{ display: "flex", gap: 5 }}><button style={smallButton} onClick={onDuplicate}><Copy size={12} /> Duplicate</button><button style={smallButton} onClick={onDelete}><Trash2 size={12} /> Delete</button></div>
    </div>
  );
}

function SourceRegionReview({ videoUrl, layout, onChange }: {
  videoUrl: string;
  layout: PortraitGamingLayout;
  onChange: (layout: PortraitGamingLayout) => void;
}) {
  const dragRef = useRef<{ id: string; startX: number; startY: number; original: Rect; bounds: DOMRect } | null>(null);
  function start(event: React.PointerEvent, region: VideoRegion) {
    event.preventDefault();
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds || region.locked) return;
    dragRef.current = { id: region.id, startX: event.clientX, startY: event.clientY, original: region.sourceCrop, bounds };
    const move = (pointer: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const x = drag.original.x + (pointer.clientX - drag.startX) / drag.bounds.width;
      const y = drag.original.y + (pointer.clientY - drag.startY) / drag.bounds.height;
      onChange({
        ...layout,
        layout: "manual",
        regions: layout.regions.map((item) => item.id === drag.id ? {
          ...item,
          sourceCrop: clampRect({ ...drag.original, x, y }),
        } : item),
      });
    };
    const stop = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }
  return (
    <div>
      <div style={{ fontSize: 10.5, marginTop: 8 }}>Detection review — drag source boxes to correct them</div>
      <div style={{ position: "relative", marginTop: 6, aspectRatio: "16/9", background: "#000", overflow: "hidden", borderRadius: 7 }}>
        <video src={videoUrl} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "fill" }} />
        {layout.regions.filter((region) => region.type === "webcam" || region.type === "gameplay").map((region) => (
          <div key={region.id} onPointerDown={(event) => start(event, region)} style={{
            position: "absolute",
            left: `${region.sourceCrop.x * 100}%`,
            top: `${region.sourceCrop.y * 100}%`,
            width: `${region.sourceCrop.width * 100}%`,
            height: `${region.sourceCrop.height * 100}%`,
            border: `2px solid ${region.type === "webcam" ? "#FFCA3A" : "#46E5C8"}`,
            color: "#fff",
            fontSize: 9,
            cursor: "move",
            boxSizing: "border-box",
          }}>
            <span style={{ background: "rgba(0,0,0,.7)", padding: "1px 3px" }}>{region.type === "webcam" ? "Webcam" : "Gameplay"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RectInputs({ rect, onChange }: { rect: Rect; onChange: (field: keyof Rect, value: number) => void }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>{(["x", "y", "width", "height"] as const).map((field) => <label key={field} style={{ fontSize: 10, color: "#A99FC2" }}>{field}<input style={input} type="number" min={0} max={1} step={.01} value={Number(rect[field].toFixed(3))} onChange={(event) => onChange(field, Number(event.target.value))} /></label>)}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "grid", gap: 5, marginTop: 9, color: "#A99FC2", fontSize: 11 }}>{label}{children}</label>;
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return <div style={{ borderBottom: "1px solid #352D47" }}><button onClick={() => setOpen(!open)} style={{ width: "100%", display: "flex", gap: 8, padding: "13px 16px", background: "transparent", border: 0, color: "#ECE8F3", fontWeight: 800, cursor: "pointer" }}>{icon}{title}</button>{open && <div style={{ padding: "0 16px 16px" }}>{children}</div>}</div>;
}

async function seekVideo(video: HTMLVideoElement, time: number) {
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Frame extraction timed out.")), 8000);
    video.onseeked = () => { clearTimeout(timeout); resolve(); };
    video.onerror = () => { clearTimeout(timeout); reject(new Error("Frame extraction failed.")); };
    video.currentTime = time;
  });
}

function cropDataUrl(canvas: HTMLCanvasElement, crop: Rect) {
  const target = document.createElement("canvas");
  target.width = 180;
  target.height = 100;
  const ctx = target.getContext("2d");
  ctx?.drawImage(canvas, crop.x * canvas.width, crop.y * canvas.height, crop.width * canvas.width, crop.height * canvas.height, 0, 0, target.width, target.height);
  return target.toDataURL("image/jpeg", .72);
}

function rectOverlap(a: Rect, b: Rect) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return (width * height) / Math.max(.0001, Math.min(a.width * a.height, b.width * b.height));
}

const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, marginBottom: 9, color: "#A99FC2", fontSize: 11.5 };
const input: React.CSSProperties = { width: "100%", background: "#13111C", border: "1px solid #352D47", borderRadius: 7, color: "#ECE8F3", padding: "6px 7px" };
const primaryButton: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, background: "#FFCA3A", color: "#1A1300", border: 0, borderRadius: 8, padding: "8px 10px", fontWeight: 800, cursor: "pointer" };
const smallButton: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, background: "#2A2438", color: "#ECE8F3", border: "1px solid #473C5E", borderRadius: 7, padding: "6px 8px", fontSize: 11, cursor: "pointer" };
const statusBox: React.CSSProperties = { display: "grid", gap: 7, marginTop: 9, padding: 10, background: "#13111C", border: "1px solid #352D47", borderRadius: 9, color: "#A99FC2", fontSize: 11.5 };
const candidateButton: React.CSSProperties = { display: "flex", alignItems: "center", gap: 5, padding: 7, background: "#211C2E", border: "1px solid #352D47", borderRadius: 8, color: "#ECE8F3", fontSize: 10.5, cursor: "pointer", textAlign: "left" };
