"use client";

import { useState } from "react";
import { Download, Type, Wand2 } from "lucide-react";
import CaptionEditor from "./CaptionEditor";
import VideoDownloader from "./VideoDownloader";

type View = "editor" | "downloader";

const colors = {
  bg: "#13111C",
  bg2: "#1A1724",
  panel: "#211C2E",
  line: "#352D47",
  text: "#ECE8F3",
  dim: "#A99FC2",
  amber: "#FFCA3A",
};

export default function CaptionForgeApp() {
  const [view, setView] = useState<View>("editor");

  return (
    <div className="cf-shell">
      <aside className="cf-tool-sidebar">
        <button
          className="cf-sidebar-brand"
          onClick={() => setView("editor")}
          title="CaptionForge — Auto-Subtitles"
        >
          <span className="cf-sidebar-logo"><Type size={19} color="#1a1300" strokeWidth={2.6} /></span>
          <span className="cf-sidebar-brand-name">Caption<span>Forge</span></span>
        </button>

        <div className="cf-sidebar-label">Tools</div>
        <nav className="cf-sidebar-nav" aria-label="CaptionForge tools">
          <SidebarButton
            active={view === "editor"}
            icon={<Wand2 size={18} />}
            label="Auto-Subtitles"
            onClick={() => setView("editor")}
          />
          <SidebarButton
            active={view === "downloader"}
            icon={<Download size={18} />}
            label="Clip Downloader"
            onClick={() => setView("downloader")}
          />
        </nav>
      </aside>

      <div className="cf-tool-content">
        <div style={{ display: view === "editor" ? "block" : "none", height: "100%" }}>
          <CaptionEditor onHome={() => setView("editor")} />
        </div>
        {view === "downloader" && <VideoDownloader />}
      </div>

      <style>{`
        .cf-shell {
          display: flex;
          width: 100%;
          height: 100vh;
          overflow: hidden;
          background: ${colors.bg};
          color: ${colors.text};
          font-family: Inter, system-ui, sans-serif;
        }
        .cf-tool-sidebar {
          width: 190px;
          flex: 0 0 190px;
          padding: 14px 10px;
          background: ${colors.bg2};
          border-right: 1px solid ${colors.line};
          display: flex;
          flex-direction: column;
          position: relative;
          z-index: 100;
        }
        .cf-sidebar-brand {
          display: flex;
          align-items: center;
          gap: 9px;
          border: 0;
          background: transparent;
          color: ${colors.text};
          padding: 0 4px 18px;
          cursor: pointer;
          text-align: left;
          font: inherit;
        }
        .cf-sidebar-logo {
          width: 32px;
          height: 32px;
          flex: 0 0 32px;
          border-radius: 9px;
          background: ${colors.amber};
          display: grid;
          place-items: center;
          box-shadow: 0 0 20px rgba(255,202,58,.25);
        }
        .cf-sidebar-brand-name {
          font-weight: 800;
          font-size: 15px;
          white-space: nowrap;
        }
        .cf-sidebar-brand-name span { color: ${colors.amber}; }
        .cf-sidebar-label {
          padding: 4px 10px 8px;
          color: #6E6486;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: .7px;
          text-transform: uppercase;
        }
        .cf-sidebar-nav { display: grid; gap: 6px; }
        .cf-sidebar-tool {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          border: 1px solid transparent;
          border-radius: 10px;
          padding: 11px 10px;
          color: ${colors.dim};
          background: transparent;
          cursor: pointer;
          font: inherit;
          font-size: 13px;
          font-weight: 700;
          text-align: left;
        }
        .cf-sidebar-tool:hover {
          color: ${colors.text};
          background: ${colors.panel};
        }
        .cf-sidebar-tool-active {
          color: ${colors.amber};
          background: rgba(255,202,58,.1);
          border-color: rgba(255,202,58,.35);
        }
        .cf-tool-content {
          min-width: 0;
          height: 100vh;
          flex: 1;
          overflow: hidden;
        }
        @media (max-width: 850px) {
          .cf-tool-sidebar { width: 64px; flex-basis: 64px; padding-inline: 8px; }
          .cf-sidebar-brand { justify-content: center; padding-inline: 0; }
          .cf-sidebar-brand-name, .cf-sidebar-label, .cf-sidebar-tool-label { display: none; }
          .cf-sidebar-tool { justify-content: center; padding-inline: 0; }
        }
      `}</style>
    </div>
  );
}

function SidebarButton({ active, icon, label, onClick }: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`cf-sidebar-tool${active ? " cf-sidebar-tool-active" : ""}`}
      onClick={onClick}
      title={label}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      <span className="cf-sidebar-tool-label">{label}</span>
    </button>
  );
}
