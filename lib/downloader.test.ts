import { describe, expect, it } from "vitest";
import { detectDownloadPlatform } from "./downloader";

describe("detectDownloadPlatform", () => {
  it("accepts supported video platforms", () => {
    expect(detectDownloadPlatform("https://youtu.be/abc")).toBe("YouTube");
    expect(detectDownloadPlatform("https://www.youtube.com/shorts/abc")).toBe("YouTube");
    expect(detectDownloadPlatform("https://www.tiktok.com/@user/video/123")).toBe("TikTok");
    expect(detectDownloadPlatform("https://www.twitch.tv/videos/123")).toBe("Twitch");
    expect(detectDownloadPlatform("https://kick.com/user/videos/abc")).toBe("Kick");
    expect(detectDownloadPlatform("https://kick.com/user?clip=clip_abc")).toBe("Kick");
    expect(detectDownloadPlatform("https://kick.com/user/clips/clip_abc")).toBe("Kick");
  });

  it("rejects unsupported and malformed URLs", () => {
    expect(detectDownloadPlatform("not a link")).toBeNull();
    expect(detectDownloadPlatform("https://example.com/video")).toBeNull();
    expect(detectDownloadPlatform("file:///video.mp4")).toBeNull();
  });
});
