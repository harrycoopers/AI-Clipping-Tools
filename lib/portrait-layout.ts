export type Rect = { x: number; y: number; width: number; height: number };
export type FitMode = "fit" | "fill" | "crop" | "stretch";
export type RegionType = "gameplay" | "webcam" | "additional";
export type LayoutType =
  | "quarter-webcam-top"
  | "quarter-webcam-bottom"
  | "webcam-top-half"
  | "webcam-bottom-half"
  | "floating-webcam"
  | "normal-camera"
  | "gameplay-only"
  | "blurred-background"
  | "custom-split"
  | "manual";

export interface VideoRegion {
  id: string;
  name: string;
  type: RegionType;
  sourceCrop: Rect;
  destination: Rect;
  fitMode: FitMode;
  zoom: number;
  panX: number;
  panY: number;
  rotation: number;
  opacity: number;
  borderRadius: number;
  borderWidth: number;
  borderColour: string;
  shadowEnabled: boolean;
  locked: boolean;
  visible: boolean;
  zIndex: number;
}

export interface WebcamCandidate {
  crop: Rect;
  confidence: number;
  label: string;
}

export interface DetectionResult {
  webcamCandidates: WebcamCandidate[];
  selectedWebcamCrop?: Rect;
  gameplayCrop: Rect;
  confidenceLevel: "high" | "medium" | "low";
  confirmed: boolean;
  message: string;
}

export interface PortraitGamingLayout {
  enabled: boolean;
  outputWidth: number;
  outputHeight: number;
  layout: LayoutType;
  splitRatio: number;
  webcamPosition: "top" | "bottom" | "overlay" | "custom";
  detection?: DetectionResult;
  regions: VideoRegion[];
  backgroundType: "black" | "solid" | "gradient" | "blurred-gameplay" | "blurred-webcam" | "image";
  backgroundColour: string;
  backgroundBlur: number;
  backgroundBrightness: number;
  snapping: boolean;
  safeArea: "none" | "tiktok" | "youtube" | "instagram";
  trackingEnabled: boolean;
  trackingKeyframes?: Array<{ time: number; panX: number; panY: number }>;
  webcamCropMode: "full" | "face-centred" | "upper-body" | "keep-border" | "custom";
}

export const FULL_RECT: Rect = { x: 0, y: 0, width: 1, height: 1 };

export function clampRect(rect: Rect, minSize = 0.02): Rect {
  const width = Math.min(1, Math.max(minSize, rect.width));
  const height = Math.min(1, Math.max(minSize, rect.height));
  return {
    x: Math.min(1 - width, Math.max(0, rect.x)),
    y: Math.min(1 - height, Math.max(0, rect.y)),
    width,
    height,
  };
}

export function makeRegion(id: string, name: string, type: RegionType, sourceCrop: Rect, destination: Rect, zIndex: number): VideoRegion {
  return {
    id, name, type, sourceCrop: clampRect(sourceCrop), destination: clampRect(destination),
    fitMode: "fill", zoom: 1, panX: 0, panY: 0, rotation: 0, opacity: 1,
    borderRadius: type === "webcam" ? 0.035 : 0, borderWidth: 0,
    borderColour: "#FFFFFF", shadowEnabled: type === "webcam", locked: false,
    visible: true, zIndex,
  };
}

export function applyLayoutPreset(
  current: PortraitGamingLayout,
  layout: LayoutType,
  splitRatio = current.splitRatio
): PortraitGamingLayout {
  const ratio = Math.min(0.85, Math.max(0.5, splitRatio));
  const gameplaySource = current.regions.find((region) => region.type === "gameplay")?.sourceCrop || FULL_RECT;
  const webcamSource = current.regions.find((region) => region.type === "webcam")?.sourceCrop
    || current.detection?.selectedWebcamCrop
    || { x: 0.72, y: 0.04, width: 0.24, height: 0.28 };
  let gameplay = FULL_RECT;
  let webcam: Rect | null = null;
  let webcamPosition: PortraitGamingLayout["webcamPosition"] = "bottom";

  if (layout === "quarter-webcam-top" || layout === "normal-camera") {
    webcam = { x: 0, y: 0, width: 1, height: 1 - ratio };
    gameplay = { x: 0, y: 1 - ratio, width: 1, height: ratio };
    webcamPosition = "top";
  } else if (layout === "quarter-webcam-bottom" || layout === "custom-split") {
    gameplay = { x: 0, y: 0, width: 1, height: ratio };
    webcam = { x: 0, y: ratio, width: 1, height: 1 - ratio };
    webcamPosition = "bottom";
  } else if (layout === "webcam-top-half") {
    webcam = { x: 0, y: 0, width: 1, height: 0.5 };
    gameplay = { x: 0, y: 0.5, width: 1, height: 0.5 };
    webcamPosition = "top";
  } else if (layout === "webcam-bottom-half") {
    gameplay = { x: 0, y: 0, width: 1, height: 0.5 };
    webcam = { x: 0, y: 0.5, width: 1, height: 0.5 };
  } else if (layout === "floating-webcam" || layout === "blurred-background") {
    gameplay = FULL_RECT;
    webcam = { x: 0.06, y: 0.68, width: 0.88, height: 0.26 };
    webcamPosition = "overlay";
  } else if (layout === "gameplay-only") {
    gameplay = FULL_RECT;
  } else {
    return { ...current, layout };
  }

  const regions = [
    makeRegion("gameplay", "Gameplay", "gameplay", gameplaySource, gameplay, 1),
    ...(webcam ? [makeRegion("webcam", "Webcam", "webcam", webcamSource, webcam, 2)] : []),
    ...current.regions.filter((region) => region.type === "additional"),
  ];
  return {
    ...current, layout, splitRatio: ratio, webcamPosition, regions,
    backgroundType: layout === "blurred-background" ? "blurred-gameplay" : current.backgroundType,
  };
}

export function createDefaultPortraitLayout(): PortraitGamingLayout {
  const base: PortraitGamingLayout = {
    enabled: false,
    outputWidth: 1080,
    outputHeight: 1920,
    layout: "quarter-webcam-bottom",
    splitRatio: 0.75,
    webcamPosition: "bottom",
    regions: [],
    backgroundType: "black",
    backgroundColour: "#000000",
    backgroundBlur: 28,
    backgroundBrightness: 0.58,
    snapping: true,
    safeArea: "tiktok",
    trackingEnabled: false,
    webcamCropMode: "full",
  };
  return applyLayoutPreset(base, base.layout, base.splitRatio);
}

export function sourcePixels(rect: Rect, sourceWidth: number, sourceHeight: number) {
  const safe = clampRect(rect);
  return {
    sx: safe.x * sourceWidth,
    sy: safe.y * sourceHeight,
    sw: safe.width * sourceWidth,
    sh: safe.height * sourceHeight,
  };
}

export function destinationPixels(rect: Rect, outputWidth: number, outputHeight: number) {
  const safe = clampRect(rect);
  return {
    dx: safe.x * outputWidth,
    dy: safe.y * outputHeight,
    dw: safe.width * outputWidth,
    dh: safe.height * outputHeight,
  };
}

export function computeCoverCrop(
  source: { sx: number; sy: number; sw: number; sh: number },
  destination: { dw: number; dh: number },
  zoom = 1,
  panX = 0,
  panY = 0
) {
  const sourceRatio = source.sw / source.sh;
  const destinationRatio = destination.dw / destination.dh;
  let sw = source.sw;
  let sh = source.sh;
  if (sourceRatio > destinationRatio) sw = source.sh * destinationRatio;
  else sh = source.sw / destinationRatio;
  sw /= Math.max(0.1, zoom);
  sh /= Math.max(0.1, zoom);
  const maxX = Math.max(0, source.sw - sw);
  const maxY = Math.max(0, source.sh - sh);
  return {
    sx: source.sx + maxX * Math.min(1, Math.max(0, 0.5 + panX / 2)),
    sy: source.sy + maxY * Math.min(1, Math.max(0, 0.5 + panY / 2)),
    sw,
    sh,
  };
}

export function confidenceLevel(score: number): DetectionResult["confidenceLevel"] {
  if (score >= 0.76) return "high";
  if (score >= 0.48) return "medium";
  return "low";
}
