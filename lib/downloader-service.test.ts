import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

const port = 14317;
const serviceUrl = `http://127.0.0.1:${port}`;
let service: ChildProcess;

beforeAll(async () => {
  service = spawn(process.execPath, [join(process.cwd(), "server", "downloader-server.mjs")], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PORT: String(port),
      YT_DLP_PATH: join(process.cwd(), "tools", "definitely-missing-yt-dlp"),
      FFMPEG_PATH: join(process.cwd(), "tools", "definitely-missing-ffmpeg"),
    },
  });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${serviceUrl}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("Downloader test service did not start.");
});

afterAll(() => {
  service?.kill();
});

describe("downloader service routing", () => {
  const supportedUrls = [
    "https://www.youtube.com/watch?v=test",
    "https://www.youtube.com/shorts/test",
    "https://www.tiktok.com/@user/video/123",
    "https://www.twitch.tv/videos/123",
    "https://kick.com/user/videos/test",
    "https://kick.com/user?clip=test",
  ];

  it.each(supportedUrls)("accepts the supported URL class %s", async (url) => {
    const response = await fetch(`${serviceUrl}/api/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ytDlp: { available: false },
      ffmpeg: { available: false },
    });
  });

  it("rejects unsupported hosts before invoking downloader tools", async () => {
    const response = await fetch(`${serviceUrl}/api/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/video" }),
    });
    expect(response.status).toBe(400);
  });

  it.each([
    "https://www.twitch.tv/videos/123",
    "https://kick.com/example/videos/abc",
  ])("routes Auto Clips VOD analysis for %s", async (url) => {
    const response = await fetch(`${serviceUrl}/api/auto-clips/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ytDlp: { available: false },
      ffmpeg: { available: false },
    });
  });
});
