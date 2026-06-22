import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const editor = readFileSync(
  join(process.cwd(), "components", "CaptionEditor.tsx"),
  "utf8"
);

describe("editor video sessions", () => {
  it("does not restore subtitles when the source video cannot be restored", () => {
    expect(editor).not.toContain("setSegments(project.segments)");
    expect(editor).not.toMatch(/applyDefaultToNew,\s*segments,\s*language/);
  });

  it("provides a new-video action that clears video-specific state", () => {
    expect(editor).toContain("function resetForNewVideo");
    expect(editor).toContain('setSegments([])');
    expect(editor).toContain('setSelectedSeg(null)');
    expect(editor).toContain('history.current = { past: [], future: [] }');
    expect(editor).toContain("Back / New video");
    expect(editor).toContain("Back to upload");
  });
});
