"use client";

import { useState } from "react";
import { Menu, Scissors, Wand2 } from "lucide-react";
import AutoClips from "./AutoClips";
import CaptionEditor from "./CaptionEditor";

type View = "subtitles" | "clips";

export default function CaptionForgeApp() {
  const [view, setView] = useState<View>("subtitles");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [incomingClip, setIncomingClip] = useState<File | null>(null);
  const [autoTranscribeToken, setAutoTranscribeToken] = useState(0);

  function sendToSubtitles(file: File) {
    setIncomingClip(file);
    setAutoTranscribeToken((token) => token + 1);
    setView("subtitles");
  }

  return (
    <div className={`cf-shell${sidebarOpen ? "" : " cf-shell-collapsed"}`}>
      <aside className="cf-main-sidebar">
        <button className="cf-main-menu" onClick={() => setSidebarOpen((open) => !open)} aria-expanded={sidebarOpen} title="Toggle tools">
          <Menu size={21} />
          <span>CaptionForge</span>
        </button>
        <nav aria-label="Tools">
          <ToolButton active={view === "subtitles"} icon={<Wand2 size={18} />} label="Auto-Subtitles" onClick={() => setView("subtitles")} />
          <ToolButton active={view === "clips"} icon={<Scissors size={18} />} label="Auto Clips" onClick={() => setView("clips")} />
        </nav>
      </aside>
      <div className="cf-main-content">
        <div style={{ display: view === "subtitles" ? "block" : "none", height: "100%" }}>
          <CaptionEditor incomingVideo={incomingClip} autoTranscribeToken={autoTranscribeToken} />
        </div>
        {view === "clips" && <AutoClips onAutoSubtitles={sendToSubtitles} />}
      </div>
      <style>{`
        .cf-shell{height:100vh;display:flex;overflow:hidden;background:#13111C;color:#ECE8F3;font-family:Inter,system-ui,sans-serif}
        .cf-main-sidebar{width:188px;flex:0 0 188px;padding:12px 9px;background:#1A1724;border-right:1px solid #352D47;z-index:100}
        .cf-main-menu,.cf-tool-button{width:100%;display:flex;align-items:center;gap:10px;border-radius:10px;border:1px solid transparent;background:transparent;color:#A99FC2;padding:11px 10px;font:inherit;font-weight:750;cursor:pointer;text-align:left}
        .cf-main-menu{margin-bottom:14px;background:#211C2E;color:#ECE8F3}
        .cf-main-menu:hover,.cf-tool-button:hover{color:#ECE8F3;border-color:#352D47}
        .cf-main-sidebar nav{display:grid;gap:6px}
        .cf-tool-button-active{color:#FFCA3A;background:rgba(255,202,58,.1);border-color:rgba(255,202,58,.32)}
        .cf-main-content{flex:1;min-width:0;height:100vh;overflow:hidden}
        .cf-shell-collapsed .cf-main-sidebar{width:62px;flex-basis:62px;padding-inline:7px}
        .cf-shell-collapsed .cf-main-menu,.cf-shell-collapsed .cf-tool-button{justify-content:center;padding-inline:0}
        .cf-shell-collapsed .cf-main-menu span,.cf-shell-collapsed .cf-tool-button span{display:none}
        @media(max-width:850px){.cf-main-sidebar{width:62px;flex-basis:62px;padding-inline:7px}.cf-main-menu,.cf-tool-button{justify-content:center;padding-inline:0}.cf-main-menu span,.cf-tool-button span{display:none}}
      `}</style>
    </div>
  );
}

function ToolButton({ active, icon, label, onClick }: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`cf-tool-button${active ? " cf-tool-button-active" : ""}`} onClick={onClick} title={label} aria-current={active ? "page" : undefined}>
      {icon}<span>{label}</span>
    </button>
  );
}
