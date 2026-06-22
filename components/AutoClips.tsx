"use client";

import { useState } from "react";
import { Film, LoaderCircle, MessageCircle, Sparkles, Wand2 } from "lucide-react";
import { parseVodSource } from "@/lib/auto-clips";
import { downloaderConnectionError, downloaderServiceUrl } from "@/lib/downloader";

interface ClipResult {
  id: string;
  title: string;
  mediaPath?: string;
  url?: string;
  embedUrl?: string;
  thumbnailUrl?: string;
  duration: number;
  reason?: string;
  source: string;
}

interface AnalysisResult {
  platform: string;
  channel: string;
  title: string;
  duration: number;
  chatReplayAvailable: boolean;
  generated: ClipResult[];
  warning: string;
}

export default function AutoClips({ onAutoSubtitles }: {
  onAutoSubtitles: (file: File) => void;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingClip, setLoadingClip] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const source = parseVodSource(url);
  const serviceUrl = downloaderServiceUrl();

  async function analyze() {
    if (!source || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      if (!serviceUrl) throw new Error(downloaderConnectionError(serviceUrl));
      const response = await fetch(`${serviceUrl}/api/auto-clips/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Analysis failed with ${response.status}.`);
      setResult(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "VOD analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  async function subtitleClip(clip: ClipResult) {
    setLoadingClip(clip.id);
    setError("");
    try {
      if (!serviceUrl) throw new Error(downloaderConnectionError(serviceUrl));
      let mediaPath = clip.mediaPath;
      if (!mediaPath && clip.url) {
        const importResponse = await fetch(`${serviceUrl}/api/auto-clips/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: clip.url }),
        });
        const imported = await importResponse.json().catch(() => null);
        if (!importResponse.ok) throw new Error(imported?.error || "The clip could not be imported.");
        mediaPath = imported.mediaPath;
      }
      if (!mediaPath) throw new Error("This clip has no downloadable media.");
      const mediaResponse = await fetch(`${serviceUrl}${mediaPath}`);
      if (!mediaResponse.ok) throw new Error("The generated clip could not be loaded.");
      const blob = await mediaResponse.blob();
      onAutoSubtitles(new File([blob], `${clip.title.replace(/[^\w -]/g, "").slice(0, 80) || "auto-clip"}.mp4`, {
        type: "video/mp4",
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The clip could not be sent to Auto-Subtitles.");
    } finally {
      setLoadingClip("");
    }
  }

  return (
    <main style={{ height: "100vh", overflow: "auto", background: "#13111C", color: "#ECE8F3", fontFamily: "Inter, system-ui, sans-serif" }}>
      <header style={{ padding: "14px 20px", borderBottom: "1px solid #352D47", background: "#1A1724", fontWeight: 800 }}>
        Auto Clips
      </header>
      <section style={{ width: "min(1100px, calc(100% - 32px))", margin: "0 auto", padding: "52px 0 80px" }}>
        <Sparkles size={34} color="#FFCA3A" />
        <h1 style={{ margin: "14px 0 10px", fontSize: "clamp(32px, 5vw, 52px)" }}>Find stream highlights</h1>
        <p style={{ color: "#A99FC2", lineHeight: 1.6, maxWidth: 760 }}>
          Paste a Twitch or Kick VOD. CaptionForge ranks reaction-heavy moments and creates playable clips you can send directly into Auto-Subtitles.
        </p>

        <div style={{ display: "flex", gap: 10, padding: 10, marginTop: 26, border: "1px solid #473C5E", borderRadius: 14, background: "#211C2E" }}>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void analyze(); }}
            placeholder="Paste a Twitch or Kick VOD link"
            style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: "transparent", color: "#ECE8F3", padding: 11, fontSize: 15 }}
          />
          <button onClick={() => void analyze()} disabled={!source || loading} style={primaryButton(!source || loading)}>
            {loading ? <LoaderCircle size={17} className="cf-spin" /> : <Sparkles size={17} />}
            {loading ? "Analyzing VOD…" : "Find highlights"}
          </button>
        </div>
        {url && !source && <p style={{ color: "#FF7DAF" }}>Enter a Twitch or Kick VOD URL.</p>}
        {loading && <div style={noticeStyle}>Long VODs must download and scan first. This can take several minutes.</div>}
        {error && <div style={{ ...noticeStyle, color: "#FF9ABB", borderColor: "rgba(255,93,162,.4)" }}>{error}</div>}

        {result && (
          <>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "30px 0 18px", color: "#A99FC2" }}>
              <span><Film size={14} /> {result.title}</span>
              <span><MessageCircle size={14} /> {result.chatReplayAvailable ? "Chat replay used" : "Audio signals used"}</span>
            </div>
            {result.warning && <div style={noticeStyle}>{result.warning}</div>}

            <ResultSection
              title="Auto-detected highlights"
              empty="No automatic highlights were generated."
              clips={result.generated}
              serviceUrl={serviceUrl}
              loadingClip={loadingClip}
              onAutoSubtitles={subtitleClip}
            />
          </>
        )}
      </section>
      <style>{`@keyframes cfSpin{to{transform:rotate(360deg)}}.cf-spin{animation:cfSpin .9s linear infinite}`}</style>
    </main>
  );
}

function ResultSection({ title, empty, clips, serviceUrl, loadingClip, onAutoSubtitles }: {
  title: string;
  empty: string;
  clips: ClipResult[];
  serviceUrl: string;
  loadingClip: string;
  onAutoSubtitles: (clip: ClipResult) => void;
}) {
  return (
    <section style={{ marginTop: 34 }}>
      <h2 style={{ fontSize: 18 }}>{title}</h2>
      {!clips.length ? <div style={noticeStyle}>{empty}</div> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {clips.map((clip) => (
            <article key={clip.id} style={{ overflow: "hidden", border: "1px solid #352D47", borderRadius: 14, background: "#1A1724" }}>
              {clip.mediaPath ? (
                <video controls preload="metadata" src={`${serviceUrl}${clip.mediaPath}`} style={{ display: "block", width: "100%", aspectRatio: "16/9", background: "#000" }} />
              ) : null}
              <div style={{ padding: 14 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>{clip.title}</div>
                <div style={{ color: "#A99FC2", fontSize: 12, marginBottom: 12 }}>{clip.reason || clip.source}</div>
                <button onClick={() => void onAutoSubtitles(clip)} disabled={loadingClip === clip.id} style={primaryButton(loadingClip === clip.id)}>
                  {loadingClip === clip.id ? <LoaderCircle size={15} className="cf-spin" /> : <Wand2 size={15} />}
                  Auto Subtitles
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

const noticeStyle: React.CSSProperties = {
  marginTop: 14,
  padding: 14,
  color: "#A99FC2",
  background: "#1A1724",
  border: "1px solid #352D47",
  borderRadius: 10,
  lineHeight: 1.5,
};

function primaryButton(disabled: boolean): React.CSSProperties {
  return {
    border: 0,
    borderRadius: 10,
    padding: "10px 16px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: "#FFCA3A",
    color: "#1a1300",
    fontWeight: 800,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
