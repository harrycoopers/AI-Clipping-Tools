import { describe, expect, it } from "vitest";
import {
  applyLayoutPreset,
  clampRect,
  computeCoverCrop,
  confidenceLevel,
  createDefaultPortraitLayout,
} from "./portrait-layout";

describe("portrait layout geometry", () => {
  it("clamps source regions inside the source frame", () => {
    expect(clampRect({ x: -1, y: 0.9, width: 2, height: 0 })).toEqual({
      x: 0, y: 0.9, width: 1, height: 0.02,
    });
  });

  it("creates true 1080x1920 defaults and editable split regions", () => {
    const layout = createDefaultPortraitLayout();
    expect([layout.outputWidth, layout.outputHeight]).toEqual([1080, 1920]);
    expect(layout.regions.find((region) => region.type === "gameplay")?.destination.height).toBe(0.75);
    expect(layout.regions.find((region) => region.type === "webcam")?.destination.y).toBe(0.75);
  });

  it("flips the webcam while retaining detected source crops", () => {
    const initial = createDefaultPortraitLayout();
    const detected = { x: 0.05, y: 0.05, width: 0.22, height: 0.26 };
    initial.regions.find((region) => region.type === "webcam")!.sourceCrop = detected;
    const next = applyLayoutPreset(initial, "quarter-webcam-top", 0.7);
    expect(next.webcamPosition).toBe("top");
    expect(next.regions.find((region) => region.type === "webcam")?.sourceCrop).toEqual(detected);
  });

  it("cover-crops without stretching", () => {
    const crop = computeCoverCrop(
      { sx: 0, sy: 0, sw: 1920, sh: 1080 },
      { dw: 1080, dh: 1440 }
    );
    expect(crop.sh).toBe(1080);
    expect(crop.sw).toBe(810);
  });

  it("uses real score thresholds for confidence labels", () => {
    expect(confidenceLevel(0.8)).toBe("high");
    expect(confidenceLevel(0.6)).toBe("medium");
    expect(confidenceLevel(0.2)).toBe("low");
  });
});
