import {
  computeCoverCrop,
  destinationPixels,
  sourcePixels,
  type PortraitGamingLayout,
  type VideoRegion,
} from "./portrait-layout";

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, r);
}

function drawRegion(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource & { videoWidth?: number; videoHeight?: number; width?: number; height?: number },
  region: VideoRegion,
  outputWidth: number,
  outputHeight: number
) {
  const sourceWidth = source.videoWidth || source.width || 1;
  const sourceHeight = source.videoHeight || source.height || 1;
  const src = sourcePixels(region.sourceCrop, sourceWidth, sourceHeight);
  const dst = destinationPixels(region.destination, outputWidth, outputHeight);
  let drawSource = src;
  if (region.fitMode !== "stretch") {
    drawSource = computeCoverCrop(src, dst, region.zoom, region.panX, region.panY);
  }
  ctx.save();
  ctx.globalAlpha = region.opacity;
  if (region.shadowEnabled) {
    ctx.shadowColor = "rgba(0,0,0,.55)";
    ctx.shadowBlur = Math.max(8, outputWidth * 0.018);
    ctx.shadowOffsetY = outputHeight * 0.006;
  }
  ctx.translate(dst.dx + dst.dw / 2, dst.dy + dst.dh / 2);
  ctx.rotate((region.rotation * Math.PI) / 180);
  ctx.translate(-dst.dw / 2, -dst.dh / 2);
  roundedRect(ctx, 0, 0, dst.dw, dst.dh, region.borderRadius * outputWidth);
  ctx.clip();

  if (region.fitMode === "fit") {
    const scale = Math.min(dst.dw / src.sw, dst.dh / src.sh);
    const width = src.sw * scale;
    const height = src.sh * scale;
    ctx.drawImage(source, src.sx, src.sy, src.sw, src.sh, (dst.dw - width) / 2, (dst.dh - height) / 2, width, height);
  } else {
    ctx.drawImage(source, drawSource.sx, drawSource.sy, drawSource.sw, drawSource.sh, 0, 0, dst.dw, dst.dh);
  }
  ctx.restore();

  if (region.borderWidth > 0) {
    ctx.save();
    ctx.translate(dst.dx + dst.dw / 2, dst.dy + dst.dh / 2);
    ctx.rotate((region.rotation * Math.PI) / 180);
    ctx.translate(-dst.dw / 2, -dst.dh / 2);
    roundedRect(ctx, 0, 0, dst.dw, dst.dh, region.borderRadius * outputWidth);
    ctx.strokeStyle = region.borderColour;
    ctx.lineWidth = region.borderWidth * outputWidth;
    ctx.stroke();
    ctx.restore();
  }
}

export function drawPortraitFrame(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource & { videoWidth?: number; videoHeight?: number; width?: number; height?: number },
  layout: PortraitGamingLayout,
  outputWidth: number,
  outputHeight: number,
  time = 0
) {
  ctx.save();
  ctx.clearRect(0, 0, outputWidth, outputHeight);
  if (layout.backgroundType === "gradient") {
    const gradient = ctx.createLinearGradient(0, 0, 0, outputHeight);
    gradient.addColorStop(0, layout.backgroundColour);
    gradient.addColorStop(1, "#111827");
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = layout.backgroundColour;
  }
  ctx.fillRect(0, 0, outputWidth, outputHeight);

  if (layout.backgroundType === "blurred-gameplay" || layout.backgroundType === "blurred-webcam") {
    const type = layout.backgroundType === "blurred-webcam" ? "webcam" : "gameplay";
    const sourceRegion = layout.regions.find((region) => region.type === type && region.visible);
    if (sourceRegion) {
      const background: VideoRegion = {
        ...sourceRegion,
        destination: { x: 0, y: 0, width: 1, height: 1 },
        fitMode: "fill",
        borderRadius: 0,
        borderWidth: 0,
        shadowEnabled: false,
      };
      ctx.save();
      ctx.filter = `blur(${layout.backgroundBlur}px) brightness(${layout.backgroundBrightness})`;
      drawRegion(ctx, source, background, outputWidth, outputHeight);
      ctx.restore();
    }
  }

  for (const region of [...layout.regions].filter((item) => item.visible).sort((a, b) => a.zIndex - b.zIndex)) {
    let renderedRegion = region;
    if (layout.trackingEnabled && region.type === "webcam" && layout.trackingKeyframes?.length) {
      const nearest = layout.trackingKeyframes.reduce((best, keyframe) =>
        Math.abs(keyframe.time - time) < Math.abs(best.time - time) ? keyframe : best
      );
      renderedRegion = { ...region, panX: nearest.panX, panY: nearest.panY };
    }
    drawRegion(ctx, source, renderedRegion, outputWidth, outputHeight);
  }
  ctx.restore();
}
