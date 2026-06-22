"use client";

import { useState } from "react";
import { Download, Link, LoaderCircle } from "lucide-react";
import {
  detectDownloadPlatform,
  downloaderConnectionError,
  downloaderServiceUrl,
} from "@/lib/downloader";

export default function VideoDownloader() {
  const [url, setUrl] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const platform = detectDownloadPlatform(url);

  async function downloadVideo() {
    if (!platform || downloading) return;
    setDownloading(true);
    setError("");

    try {
      const serviceUrl = downloaderServiceUrl();
      if (!serviceUrl) throw new Error(downloaderConnectionError(serviceUrl));

      let health: Response;
      try {
        health = await fetch(`${serviceUrl}/health`, {
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        throw new Error(downloaderConnectionError(serviceUrl));
      }
      const status = await health.json().catch(() => null);
      if (!health.ok) throw new Error(status?.error || "The downloader service health check failed.");
      if (!status?.ytDlp?.available) {
        throw new Error("The downloader service is running, but yt-dlp is not installed. Run \"npm run downloader:setup\", then restart the service.");
      }
      if (!status?.ffmpeg?.available) {
        throw new Error("The downloader service is running, but FFmpeg is not configured. Install FFmpeg or set FFMPEG_PATH.");
      }

      const response = await fetch(`${serviceUrl}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), maxHeight: 1080, maxFps: 60 }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Download service returned ${response.status}.`);
      }

      const blob = await response.blob();
      if (!blob.size) throw new Error("The download service returned an empty file.");
      const disposition = response.headers.get("content-disposition") || "";
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const plain = disposition.match(/filename="([^"]+)"/i)?.[1];
      const filename = encoded ? decodeURIComponent(encoded) : plain || `${platform.toLowerCase()}-video.mp4`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The video could not be downloaded.";
      setError(message === "Failed to fetch" ? downloaderConnectionError(downloaderServiceUrl()) : message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main style={{ height: "100vh", overflow: "auto", background: "#13111C", color: "#ECE8F3", fontFamily: "Inter, system-ui, sans-serif" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid #352D47", background: "#1A1724" }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>Video Downloader</div>
      </header>

      <section style={{ width: "min(760px, calc(100% - 32px))", margin: "0 auto", padding: "70px 0" }}>
        <div style={{ color: "#FFCA3A", marginBottom: 16 }}><Download size={34} /></div>
        <h1 style={{ fontSize: "clamp(32px, 6vw, 54px)", margin: "0 0 12px", lineHeight: 1.05 }}>Download source videos</h1>
        <p style={{ color: "#A99FC2", fontSize: 16, lineHeight: 1.6, marginBottom: 28 }}>
          Paste a YouTube video or Short, TikTok video, Twitch VOD, or Kick VOD/clip link. The service selects the best available MP4 quality up to 1080p and 60fps.
        </p>

        <div style={{ display: "flex", gap: 10, background: "#211C2E", border: "1px solid #473C5E", borderRadius: 14, padding: 10 }}>
          <div style={{ display: "grid", placeItems: "center", paddingLeft: 6, color: "#A99FC2" }}><Link size={19} /></div>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void downloadVideo(); }}
            placeholder="Paste a YouTube, TikTok, Twitch or Kick link"
            style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: "transparent", color: "#ECE8F3", fontSize: 15, padding: "10px 4px" }}
          />
          <button disabled={!platform || downloading} onClick={() => void downloadVideo()} style={{
            border: 0,
            borderRadius: 10,
            padding: "0 18px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "#FFCA3A",
            color: "#1a1300",
            fontWeight: 800,
            cursor: platform && !downloading ? "pointer" : "not-allowed",
            opacity: platform && !downloading ? 1 : 0.45,
          }}>
            {downloading ? <LoaderCircle size={17} className="cf-spin" /> : <Download size={17} />}
            {downloading ? "Downloading…" : "Download"}
          </button>
        </div>

        {url && !platform && <p style={{ color: "#FF6B9D", marginTop: 12 }}>Enter a supported YouTube, TikTok, Twitch or Kick URL.</p>}
        {platform && !error && <p style={{ color: "#56E0C5", marginTop: 12 }}>{platform} link detected.</p>}
        {error && <div style={{ marginTop: 18, padding: 14, borderRadius: 10, background: "rgba(255,107,157,.1)", border: "1px solid rgba(255,107,157,.35)", color: "#FF9ABB", lineHeight: 1.5 }}>{error}</div>}

        <div style={{ marginTop: 34, padding: 18, borderRadius: 12, background: "#1A1724", border: "1px solid #352D47", color: "#A99FC2", lineHeight: 1.6, fontSize: 13 }}>
          Download only videos you own or have permission to use. Output quality is limited by the source. The companion downloader service must be running locally or configured through <code>NEXT_PUBLIC_DOWNLOADER_API_URL</code>.
        </div>
      </section>
      <style>{`@keyframes cfSpin{to{transform:rotate(360deg)}}.cf-spin{animation:cfSpin .9s linear infinite}`}</style>
    </main>
  );
}
