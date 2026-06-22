"use client";

import { useState } from "react";
import { Download, Type, Wand2 } from "lucide-react";
import CaptionEditor from "./CaptionEditor";
import VideoDownloader from "./VideoDownloader";

type View = "home" | "editor" | "downloader";

const colors = {
  bg: "#13111C",
  panel: "#211C2E",
  line: "#352D47",
  text: "#ECE8F3",
  dim: "#A99FC2",
  amber: "#FFCA3A",
};

export default function CaptionForgeApp() {
  const [view, setView] = useState<View>("home");

  return (
    <>
      <div style={{ display: view === "editor" ? "block" : "none" }}>
        <CaptionEditor onHome={() => setView("home")} />
      </div>
      {view === "downloader" && <VideoDownloader onHome={() => setView("home")} />}
      {view === "home" && (
        <main style={{
          minHeight: "100vh",
          background: colors.bg,
          color: colors.text,
          fontFamily: "Inter, system-ui, sans-serif",
          padding: 28,
          display: "grid",
          placeItems: "center",
        }}>
          <div style={{ width: "min(900px, 100%)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 42 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: colors.amber, display: "grid", placeItems: "center" }}>
                <Type size={23} color="#1a1300" strokeWidth={2.6} />
              </div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>Caption<span style={{ color: colors.amber }}>Forge</span></div>
            </div>
            <h1 style={{ fontSize: "clamp(34px, 6vw, 64px)", lineHeight: 1, margin: "0 0 14px", maxWidth: 700 }}>
              Video tools that run around your workflow.
            </h1>
            <p style={{ color: colors.dim, fontSize: 17, margin: "0 0 34px", maxWidth: 650, lineHeight: 1.6 }}>
              Generate and edit subtitles, or download source clips for projects you have permission to use.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: 16 }}>
              <HomeCard
                icon={<Wand2 size={24} />}
                title="Subtitle Editor"
                description="Transcribe speech, style captions and export finished MP4 videos."
                onClick={() => setView("editor")}
              />
              <HomeCard
                icon={<Download size={24} />}
                title="Video Downloader"
                description="Download YouTube, Shorts, TikTok, Twitch, and Kick VODs or clips up to 1080p 60fps."
                onClick={() => setView("downloader")}
              />
            </div>
          </div>
        </main>
      )}
    </>
  );
}

function HomeCard({ icon, title, description, onClick }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      textAlign: "left",
      color: colors.text,
      background: colors.panel,
      border: `1px solid ${colors.line}`,
      borderRadius: 18,
      padding: 24,
      cursor: "pointer",
      font: "inherit",
    }}>
      <div style={{ color: colors.amber, marginBottom: 20 }}>{icon}</div>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>{title}</div>
      <div style={{ color: colors.dim, lineHeight: 1.55 }}>{description}</div>
    </button>
  );
}
