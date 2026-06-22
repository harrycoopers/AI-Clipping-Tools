"use client";

import { useState } from "react";
import { Download, Menu, Wand2 } from "lucide-react";
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className={`cf-shell${sidebarOpen ? "" : " cf-sidebar-collapsed"}`}>
      <aside className="cf-tool-sidebar">
        <button
          className="cf-sidebar-toggle"
          onClick={() => setSidebarOpen((open) => !open)}
          title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          aria-expanded={sidebarOpen}
        >
          <Menu size={21} />
          <span className="cf-sidebar-toggle-label">CaptionForge</span>
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
        .cf-sidebar-toggle {
          display: flex;
          align-items: center;
          gap: 11px;
          min-height: 38px;
          border: 1px solid transparent;
          border-radius: 9px;
          background: ${colors.panel};
          color: ${colors.text};
          padding: 8px 10px;
          margin-bottom: 14px;
          cursor: pointer;
          text-align: left;
          font: inherit;
        }
        .cf-sidebar-toggle:hover {
          border-color: ${colors.line};
          color: ${colors.amber};
        }
        .cf-sidebar-toggle-label {
          font-weight: 800;
          font-size: 14px;
          white-space: nowrap;
        }
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
        .cf-sidebar-collapsed .cf-tool-sidebar {
          width: 64px;
          flex-basis: 64px;
          padding-inline: 8px;
        }
        .cf-sidebar-collapsed .cf-sidebar-toggle {
          justify-content: center;
          padding-inline: 0;
        }
        .cf-sidebar-collapsed .cf-sidebar-toggle-label,
        .cf-sidebar-collapsed .cf-sidebar-label,
        .cf-sidebar-collapsed .cf-sidebar-tool-label {
          display: none;
        }
        .cf-sidebar-collapsed .cf-sidebar-tool {
          justify-content: center;
          padding-inline: 0;
        }
        @media (max-width: 850px) {
          .cf-tool-sidebar { width: 64px; flex-basis: 64px; padding-inline: 8px; }
          .cf-sidebar-toggle { justify-content: center; padding-inline: 0; }
          .cf-sidebar-toggle-label, .cf-sidebar-label, .cf-sidebar-tool-label { display: none; }
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
