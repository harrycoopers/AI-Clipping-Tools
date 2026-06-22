import { describe, expect, it } from "vitest";
import { parseVodSource, rankHighlightWindows } from "./auto-clips";

describe("Auto Clips core", () => {
  it("recognizes Twitch and Kick VOD/channel links", () => {
    expect(parseVodSource("https://twitch.tv/example/videos/123")).toEqual({ platform: "Twitch", channel: "example" });
    expect(parseVodSource("https://twitch.tv/videos/123")).toEqual({ platform: "Twitch", channel: "" });
    expect(parseVodSource("https://kick.com/example/videos/abc")).toEqual({ platform: "Kick", channel: "example" });
    expect(parseVodSource("https://youtube.com/watch?v=x")).toBeNull();
  });

  it("ranks separated chat and audio spikes", () => {
    const result = rankHighlightWindows([
      { time: 20, audio: 2, chat: 50 },
      { time: 24, audio: 3, chat: 45 },
      { time: 90, audio: 9, chat: 2 },
      { time: 160, audio: 5, chat: 30 },
    ], 200, { maxClips: 3, clipDuration: 30 });
    expect(result).toHaveLength(3);
    expect(result.some((clip) => clip.reason === "Chat activity spike")).toBe(true);
    expect(result.every((clip) => clip.end > clip.start)).toBe(true);
  });
});
