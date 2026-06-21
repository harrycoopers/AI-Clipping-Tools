"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Upload, Play, Pause, Wand2, ChevronDown, Plus, Copy, Trash2, Split,
  Merge, Download, Star, Lock, Unlock, RotateCcw, Search, Type,
  Check, X, FileUp, FileDown, Crosshair, Eye, EyeOff, Film,
  Sparkles, AlignLeft, AlignCenter, AlignRight, Pencil, Layers,
} from "lucide-react";
import {
  ORIGINAL_DEFAULT, applyCaps, srtTime, parseSubs as parseSubsLib,
  clamp, type SubtitleStyle, type Preset, type Segment,
} from "@/lib/subtitles";

/* ---------------------------------------------------------------------------
   CaptionForge — auto-subtitle preset system + working caption editor core.

   Persistence note: this single-file build runs inside an in-chat preview that
   blocks browser storage, so presets live in React state and persist via the
   Export/Import JSON buttons. In the Next.js app, swap `usePresetStore` for the
   localStorage/IndexedDB adapter described in the notes — the shape is identical.
--------------------------------------------------------------------------- */





interface VideoMeta {
  url: string;
  file: File;
  name: string;
  size: number;
  duration: number;
  w: number;
  h: number;
}

interface CustomFont {
  name: string;
  url: string;
}

const C = {
  bg: "#13111C",
  bg2: "#1A1724",
  panel: "#211C2E",
  panel2: "#2A2438",
  line: "#352D47",
  line2: "#473C5E",
  text: "#ECE8F3",
  dim: "#A99FC2",
  faint: "#6E6486",
  amber: "#FFCA3A",   // caption yellow — the product's own signature
  pink: "#FF5DA2",    // word-highlight magenta
  mint: "#46E5C8",
  blue: "#7C9DFF",
};

const FONTS = [
  "Komika Axis", "Montserrat ExtraBold",
  "Inter", "Poppins", "Montserrat", "Bebas Neue", "Anton",
  "Archivo Black", "Space Grotesk", "Roboto", "Oswald", "Arial",
];

// ---- The built-in original default preset (per spec) -----------------------


const PRESET_LIBRARY: { name: string; style: SubtitleStyle }[] = [
  { name: "Shorts Style", style: { ...ORIGINAL_DEFAULT, fontFamily: "Bebas Neue", fontSizePct: 7, color: "#FFFFFF", highlightColor: "#FFCA3A", animation: "karaoke", y: 70, caps: "upper", wordsPerSubtitle: 4 } },
  { name: "Clean White", style: { ...ORIGINAL_DEFAULT, fontFamily: "Inter", fontSizePct: 5, bold: true, outlineWidthPct: 4, animation: "fade", caps: "none", y: 86 } },
  { name: "Gaming Captions", style: { ...ORIGINAL_DEFAULT, fontFamily: "Archivo Black", color: "#9CFF57", outlineColor: "#0A0A0A", outlineWidthPct: 9, highlightColor: "#FF5DA2", animation: "pop", caps: "upper", y: 80 } },
  { name: "Podcast Captions", style: { ...ORIGINAL_DEFAULT, fontFamily: "Poppins", fontSizePct: 4.4, color: "#FFFFFF", bgColor: "#000000", bgOpacity: 0.55, bgPadding: 16, cornerRadius: 14, outlineWidthPct: 0, animation: "slideUp", caps: "none", y: 82 } },
  { name: "Bold Viral", style: { ...ORIGINAL_DEFAULT, fontFamily: "Anton", fontSizePct: 7.4, color: "#FFFFFF", highlightColor: "#FFCA3A", highlightBg: "#000000", outlineWidthPct: 8, animation: "wordHighlight", caps: "upper", y: 72 } },
  { name: "Custom Brand Style", style: { ...ORIGINAL_DEFAULT, fontFamily: "Space Grotesk", color: "#FFCA3A", outlineColor: "#13111C", highlightColor: "#46E5C8", animation: "zoom", caps: "upper", y: 78 } },
];

const ANIMATIONS = ["none", "fade", "pop", "bounce", "zoom", "slideUp", "wordHighlight", "karaoke"];
const CAPS: [SubtitleStyle["caps"], string][] = [["none", "Aa"], ["upper", "AA"], ["lower", "aa"], ["title", "Ab"]];
const POS_PRESETS: [string, number, number][] = [["Top", 50, 12], ["Centre", 50, 50], ["Lower third", 50, 70], ["Bottom", 50, 84]];

const uid = () => Math.random().toString(36).slice(2, 10);



// Build a thick, solid outline from layered text-shadows (matches the viral look
// far better than -webkit-text-stroke, and is reproducible in FFmpeg drawtext).
function outlineShadow(px: number, color: string, opacity: number) {
  if (px <= 0) return "";
  const c = hexA(color, opacity);
  const steps: string[] = [];
  const r = px;
  for (let a = 0; a < 360; a += 30) {
    const dx = Math.cos((a * Math.PI) / 180) * r;
    const dy = Math.sin((a * Math.PI) / 180) * r;
    steps.push(`${dx.toFixed(1)}px ${dy.toFixed(1)}px 0 ${c}`);
  }
  return steps.join(", ");
}

function hexA(hex: string, a: number) {
  if (hex === "transparent") return "transparent";
  const m = hex.replace("#", "");
  const f = m.length === 3 ? m.split("").map((x) => x + x).join("") : m;
  const r = parseInt(f.slice(0, 2), 16), g = parseInt(f.slice(2, 4), 16), b = parseInt(f.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function fmt(t: number) {
  if (!isFinite(t)) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}



// ===========================================================================
//  Subtitle rendering on the preview overlay
// ===========================================================================
function CaptionLayer({ seg, style, previewH, currentTime, dragging }: {
  seg: Segment; style: SubtitleStyle; previewH: number; currentTime: number; dragging: boolean;
}) {
  const fontPx = (style.fontSizePct / 100) * previewH;
  const outlinePx = (style.outlineWidthPct / 100) * fontPx;
  const text = applyCaps(seg.text, style.caps);
  const words = text.split(/\s+/).filter(Boolean);
  const isHL = style.animation === "wordHighlight" || style.animation === "karaoke";
  const dur = Math.max(0.001, seg.end - seg.start);
  const prog = clamp((currentTime - seg.start) / dur, 0, 1);
  const activeWord = Math.floor(prog * words.length);

  const shadows: string[] = [];
  const ol = outlineShadow(outlinePx, style.outlineColor, style.outlineOpacity);
  if (ol) shadows.push(ol);
  if (style.shadowBlur > 0 || style.shadowDistance > 0)
    shadows.push(`${style.shadowDistance}px ${style.shadowDistance}px ${style.shadowBlur}px ${hexA(style.shadowColor, style.shadowOpacity)}`);


  const textStyle = {
    fontFamily: `'${style.customFontName || style.fontFamily}', sans-serif`,
    fontSize: fontPx,
    fontWeight: style.bold ? 800 : 500,
    fontStyle: style.italic ? "italic" : "normal",
    color: style.color,
    letterSpacing: `${style.letterSpacing * (fontPx / 30)}px`,
    lineHeight: style.lineSpacing,
    textShadow: shadows.join(", "),
    textAlign: style.align,
    margin: 0,
    WebkitFontSmoothing: "antialiased",
  };

  const animClass = !isHL && style.animation !== "none" ? `cf-anim-${style.animation}` : "";

  return (
    <div
      style={{
        position: "absolute",
        left: `${style.x}%`,
        top: `${style.y}%`,
        transform: "translate(-50%, -50%)",
        maxWidth: `${style.maxWidthPct}%`,
        padding: style.bgOpacity > 0 ? style.bgPadding : 0,
        background: style.bgOpacity > 0 ? hexA(style.bgColor, style.bgOpacity) : "transparent",
        borderRadius: style.cornerRadius,
        cursor: dragging ? "grabbing" : "grab",
        userSelect: "none",
        pointerEvents: "auto",
      }}
      key={animClass + seg.id + currentTime.toFixed(0)}
      className={animClass}
    >
      <p style={textStyle}>
        {isHL
          ? words.map((w, i) => {
              const on = i <= activeWord;
              return (
                <span key={i} style={{
                  color: on ? style.highlightColor : style.color,
                  background: on && style.highlightBg !== "transparent" ? style.highlightBg : "transparent",
                  borderRadius: 6,
                  padding: style.highlightBg !== "transparent" ? "0 .12em" : 0,
                  transition: "color .12s",
                }}>{w}{" "}</span>
              );
            })
          : text}
      </p>
    </div>
  );
}

// Tiny live sample used on each preset chip
function PresetThumb({ style }: { style: SubtitleStyle }) {
  const fontPx = 18;
  const ol = (style.outlineWidthPct / 100) * fontPx;
  const shadows = [outlineShadow(ol, style.outlineColor, style.outlineOpacity)].filter(Boolean);
  return (
    <div style={{
      height: 46, borderRadius: 8, background: "#0C0A12",
      display: "flex", alignItems: "center", justifyContent: "center",
      overflow: "hidden", border: `1px solid ${C.line}`,
      backgroundImage: "linear-gradient(135deg,#1a1426,#0c0a12)",
    }}>
      <span style={{
        fontFamily: `'${style.fontFamily}', sans-serif`,
        fontSize: fontPx, fontWeight: style.bold ? 800 : 500,
        fontStyle: style.italic ? "italic" : "normal",
        color: style.color, textShadow: shadows.join(", "),
        background: style.bgOpacity > 0 ? hexA(style.bgColor, style.bgOpacity) : "transparent",
        padding: style.bgOpacity > 0 ? "1px 6px" : 0, borderRadius: 4,
        letterSpacing: ".3px", whiteSpace: "nowrap",
      }}>
        {applyCaps("Aa Bb", style.caps) || "Aa"}
        {(style.animation === "wordHighlight" || style.animation === "karaoke") && (
          <span style={{ color: style.highlightColor }}> Cc</span>
        )}
      </span>
    </div>
  );
}

// ===========================================================================
//  Small UI atoms
// ===========================================================================
type BtnKind = "ghost" | "solid" | "danger";
const Btn = ({ children, onClick, kind = "ghost", title, disabled, style }: {
  children: React.ReactNode; onClick?: () => void; kind?: BtnKind; title?: string;
  disabled?: boolean; style?: React.CSSProperties;
}) => {
  const base = { ghost: { bg: "transparent", bd: C.line2, fg: C.text }, solid: { bg: C.amber, bd: C.amber, fg: "#1a1300" }, danger: { bg: "transparent", bd: "#5a2230", fg: "#ff7a93" } }[kind];
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      className="cf-btn" style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 11px",
        borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
        background: base.bg, border: `1px solid ${base.bd}`, color: base.fg, opacity: disabled ? 0.45 : 1,
        whiteSpace: "nowrap", ...style,
      }}>{children}</button>
  );
};

const Field = ({ label, children, hint }: {
  label: string; children: React.ReactNode; hint?: React.ReactNode;
}) => (
  <label style={{ display: "block", marginBottom: 11 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
      <span style={{ fontSize: 11, color: C.dim, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".4px" }}>{label}</span>
      {hint != null && <span style={{ fontSize: 11, color: C.amber, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{hint}</span>}
    </div>
    {children}
  </label>
);

const Slide = ({ value, min, max, step = 1, onChange }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void;
}) => (
  <input type="range" min={min} max={max} step={step} value={value} className="cf-range"
    onChange={(e) => onChange(parseFloat(e.target.value))} style={{ width: "100%" }} />
);

const Color = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <input type="color" value={value === "transparent" ? "#000000" : value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: 34, height: 28, padding: 0, border: `1px solid ${C.line2}`, borderRadius: 7, background: "none", cursor: "pointer" }} />
    <input value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false}
      style={{ flex: 1, background: C.bg2, border: `1px solid ${C.line}`, borderRadius: 7, color: C.text, padding: "6px 8px", fontSize: 12, fontFamily: "monospace" }} />
  </div>
);

const Toggle = ({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) => (
  <button onClick={() => onChange(!on)} style={{
    display: "flex", alignItems: "center", gap: 9, width: "100%", background: "transparent",
    border: "none", cursor: "pointer", padding: "3px 0", color: C.text, fontSize: 12.5, fontWeight: 600,
  }}>
    <span style={{
      width: 36, height: 20, borderRadius: 99, background: on ? C.amber : C.line2,
      position: "relative", transition: "background .15s", flexShrink: 0,
    }}>
      <span style={{
        position: "absolute", top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: 99,
        background: on ? "#1a1300" : C.dim, transition: "left .15s",
      }} />
    </span>
    <span style={{ textAlign: "left" }}>{label}</span>
  </button>
);

const Seg = ({ options, value, onChange }: {
  options: (string | [string, React.ReactNode])[]; value: string; onChange: (v: string) => void;
}) => (
  <div style={{ display: "flex", background: C.bg2, borderRadius: 8, padding: 3, gap: 3 }}>
    {options.map((o) => {
      const val = Array.isArray(o) ? o[0] : o;
      const lbl = Array.isArray(o) ? o[1] : o;
      const on = val === value;
      return (
        <button key={val} onClick={() => onChange(val)} style={{
          flex: 1, padding: "6px 4px", borderRadius: 6, border: "none", cursor: "pointer",
          background: on ? C.panel2 : "transparent", color: on ? C.amber : C.dim,
          fontSize: 12, fontWeight: 700, textTransform: "capitalize",
        }}>{lbl}</button>
      );
    })}
  </div>
);

const Section = ({ title, icon, children, defaultOpen = true }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: `1px solid ${C.line}` }}>
      <button onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "13px 16px",
        background: "transparent", border: "none", cursor: "pointer", color: C.text,
      }}>
        {icon}
        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".3px", flex: 1, textAlign: "left" }}>{title}</span>
        <ChevronDown size={15} color={C.faint} style={{ transform: open ? "rotate(180deg)" : "none", transition: ".15s" }} />
      </button>
      {open && <div style={{ padding: "0 16px 16px" }}>{children}</div>}
    </div>
  );
};

// ===========================================================================
//  Main app
// ===========================================================================
export default function CaptionEditor() {
  // ---- presets ----
  const [presets, setPresets] = useState<Preset[]>(() => {
    const lib = PRESET_LIBRARY.map((p) => ({ id: uid(), name: p.name, builtin: false, style: p.style }));
    return [{ id: "original", name: "Original default", builtin: true, style: ORIGINAL_DEFAULT }, ...lib];
  });
  const [defaultId, setDefaultId] = useState("original");
  const [autoChoiceId, setAutoChoiceId] = useState("__default__"); // dropdown beside Auto-Generate
  const [activePresetId, setActivePresetId] = useState("original"); // preset being edited in the style panel
  const [applyDefaultToNew, setApplyDefaultToNew] = useState(true);

  // ---- video + segments ----
  const [video, setVideo] = useState<VideoMeta | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSeg, setSelectedSeg] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [locked, setLocked] = useState(false);
  const [showSafe, setShowSafe] = useState(true);
  const [autoOpen, setAutoOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState("");

  // undo / redo
  const history = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] });
  const pushHistory = useCallback((segs: Segment[]) => {
    history.current.past.push(JSON.stringify(segs));
    if (history.current.past.length > 60) history.current.past.shift();
    history.current.future = [];
  }, []);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; rect: DOMRect } | null>(null);
  const [previewH, setPreviewH] = useState(360);

  const resolvedAutoPreset = useMemo(() => {
    const id = autoChoiceId === "__default__" ? defaultId : autoChoiceId;
    return presets.find((p) => p.id === id) || presets[0];
  }, [autoChoiceId, defaultId, presets]);

  const activePreset = presets.find((p) => p.id === activePresetId) || presets[0];

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  // ---- effective style for a segment: preset baseline + per-segment override ----
  const styleFor = useCallback((seg: Segment): SubtitleStyle => {
    const base = (presets.find((p) => p.id === seg.presetId) || presets.find((p) => p.id === defaultId) || presets[0]).style;
    return { ...base, ...(seg.styleOverride || {}) };
  }, [presets, defaultId]);

  const activeSeg = useMemo(
    () => segments.find((s) => currentTime >= s.start && currentTime < s.end),
    [segments, currentTime]
  );

  // ---- video upload ----
  function loadVideo(file: File | undefined | null) {
    if (!file) return;
    const ok = ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo", "video/x-matroska"];
    if (!ok.includes(file.type) && !/\.(mp4|mov|webm|avi|mkv)$/i.test(file.name)) {
      flash("Unsupported format — use MP4, MOV, WebM, AVI or MKV");
      return;
    }
    if (file.size > 600 * 1024 * 1024) { flash("File too large for the in-browser preview (max 600MB)"); return; }
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      setVideo({ url, file, name: file.name, size: file.size, duration: v.duration, w: v.videoWidth, h: v.videoHeight });
      setCurrentTime(0); setPlaying(false);
    };
    v.onerror = () => flash("Could not read this video file");
    v.src = url;
  }

  // ---- custom font upload ----
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  function loadFont(file: File | undefined | null) {
    if (!file) return;
    if (!/\.(ttf|otf|woff2?|woff)$/i.test(file.name)) { flash("Use a .ttf, .otf, .woff or .woff2 file"); return; }
    const name = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9 _-]/g, "");
    const url = URL.createObjectURL(file);
    const ff = new FontFace(name, `url(${url})`);
    ff.load().then((f) => {
      document.fonts.add(f);
      setCustomFonts((p) => [...p.filter((x) => x.name !== name), { name, url }]);
      flash(`Font “${name}” loaded`);
    }).catch(() => flash("That font file could not be parsed"));
  }

  // ---- playback loop ----
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) setCurrentTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    if (playing) { videoRef.current?.play().catch(() => {}); raf = requestAnimationFrame(tick); }
    else videoRef.current?.pause();
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    const ro = () => { if (previewRef.current) setPreviewH(previewRef.current.clientHeight); };
    ro(); window.addEventListener("resize", ro);
    return () => window.removeEventListener("resize", ro);
  }, [video]);

  // ---- segment ops ----
  const commit = (next: Segment[]) => { pushHistory(segments); setSegments(next); };

  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  async function autoGenerate(srtText?: string) {
    const preset = resolvedAutoPreset;
    let raw: { start: number; end: number; text: string }[] = [];

    if (srtText) {
      // Real captions from an imported SRT/VTT file.
      raw = parseSubs(srtText);
    } else if (video) {
      // STATIC BUILD: there is no server to run speech-to-text. Real in-browser
      // transcription (Whisper via Transformers.js / WebGPU) is a separate
      // feature. For now Auto-Generate lays out evenly-timed placeholder
      // segments so you can dial in the preset look, then edit the text or
      // import an SRT for real wording. This is deliberately NOT presented as
      // a transcription of the actual audio.
      setTranscribing(true);
      setTranscribeError(
        "Auto-Generate created evenly-timed placeholder captions to preview your preset. Edit the text, or import an SRT/VTT for real wording. (In-browser speech-to-text is a planned addition.)"
      );
      const sample =
        "edit this caption or import an srt for the real words this preview is timed across your clip so you can confirm the preset look"
          .split(" ");
      const per = preset.style.wordsPerSubtitle || 5;
      const count = Math.max(1, Math.floor(video.duration / 2.2));
      for (let i = 0; i < count; i++) {
        const chunk: string[] = [];
        for (let k = 0; k < per; k++) chunk.push(sample[(i * per + k) % sample.length]);
        raw.push({ start: i * 2.2, end: i * 2.2 + 2.0, text: chunk.join(" ") });
      }
      setTranscribing(false);
    }

    if (!raw.length) {
      flash("Upload a video or import an SRT first");
      return;
    }
    pushHistory(segments);
    setSegments(
      raw.map((r) => ({ id: uid(), start: r.start, end: r.end, text: r.text, presetId: preset.id, styleOverride: null }))
    );
    setAutoOpen(false);
    flash(`Generated ${raw.length} captions with "${preset.name}"`);
  }

  const parseSubs = parseSubsLib;

  const updateSeg = (id: string, patch: Partial<Segment>) => commit(segments.map((s) => s.id === id ? { ...s, ...patch } : s));
  const editText = (id: string, text: string) => commit(segments.map((s) => s.id === id ? { ...s, text } : s));

  function addSeg() {
    const start = currentTime;
    const seg: Segment = { id: uid(), start, end: start + 2, text: "New caption", presetId: applyDefaultToNew ? defaultId : activePresetId, styleOverride: null };
    commit([...segments, seg].sort((a, b) => a.start - b.start));
    setSelectedSeg(seg.id);
  }
  const delSeg = (id: string) => commit(segments.filter((s) => s.id !== id));
  const dupSeg = (id: string) => {
    const s = segments.find((x) => x.id === id); if (!s) return;
    const copy: Segment = { ...s, id: uid(), start: s.end, end: s.end + (s.end - s.start) };
    commit([...segments, copy].sort((a, b) => a.start - b.start));
  };
  const splitSeg = (id: string) => {
    const s = segments.find((x) => x.id === id); if (!s) return;
    const mid = (s.start + s.end) / 2;
    const words = s.text.split(" ");
    const h = Math.ceil(words.length / 2);
    commit([
      ...segments.filter((x) => x.id !== id),
      { ...s, end: mid, text: words.slice(0, h).join(" ") },
      { ...s, id: uid(), start: mid, text: words.slice(h).join(" ") },
    ].sort((a, b) => a.start - b.start));
  };
  const mergeNext = (id: string) => {
    const i = segments.findIndex((x) => x.id === id);
    if (i < 0 || i >= segments.length - 1) return;
    const a = segments[i], b = segments[i + 1];
    commit([...segments.slice(0, i), { ...a, end: b.end, text: `${a.text} ${b.text}` }, ...segments.slice(i + 2)]);
  };

  function applySearchReplace() {
    if (!search) return;
    commit(segments.map((s) => ({ ...s, text: s.text.split(search).join(replace) })));
    flash(`Replaced “${search}” → “${replace}”`);
  }

  function undo() {
    if (!history.current.past.length) return;
    history.current.future.push(JSON.stringify(segments));
    setSegments(JSON.parse(history.current.past.pop() as string));
  }
  function redo() {
    if (!history.current.future.length) return;
    history.current.past.push(JSON.stringify(segments));
    setSegments(JSON.parse(history.current.future.pop() as string));
  }

  // ---- style edits write to the active preset (explicit) ----
  function patchActivePreset(patch: Partial<SubtitleStyle>) {
    setPresets((ps) => ps.map((p) => p.id === activePresetId ? { ...p, style: { ...p.style, ...patch } } : p));
  }
  // ---- manual per-segment override (only this segment) ----
  function patchSegStyle(id: string, patch: Partial<SubtitleStyle>) {
    commit(segments.map((s) => s.id === id ? { ...s, styleOverride: { ...(s.styleOverride || {}), ...patch } } : s));
  }

  // ---- preset lifecycle ----
  const newPreset = () => {
    const p: Preset = { id: uid(), name: "New preset", builtin: false, style: { ...activePreset.style } };
    setPresets((ps) => [...ps, p]); setActivePresetId(p.id); setRenameId(p.id);
  };
  const dupPreset = () => {
    const p: Preset = { id: uid(), name: `${activePreset.name} copy`, builtin: false, style: { ...activePreset.style } };
    setPresets((ps) => [...ps, p]); setActivePresetId(p.id);
  };
  const delPreset = (id: string) => {
    if (id === "original") { flash("The original default can’t be deleted"); return; }
    setPresets((ps) => ps.filter((p) => p.id !== id));
    if (defaultId === id) setDefaultId("original");
    if (activePresetId === id) setActivePresetId("original");
  };
  const saveAsDefault = () => { setDefaultId(activePresetId); flash(`“${activePreset.name}” is now your auto-subtitle default`); };
  const resetOriginal = () => {
    setPresets((ps) => ps.map((p) => p.id === "original" ? { ...p, style: ORIGINAL_DEFAULT } : p));
    setDefaultId("original");
    flash("Restored the original default preset");
  };
  function exportPreset(p: Preset) {
    download(`${p.name.replace(/\s+/g, "-").toLowerCase()}.preset.json`, JSON.stringify({ kind: "captionforge-preset", name: p.name, style: p.style }, null, 2));
  }
  function importPreset(file: File) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const j = JSON.parse(r.result as string);
        if (j.kind !== "captionforge-preset" || !j.style) throw 0;
        const p: Preset = { id: uid(), name: j.name || "Imported preset", builtin: false, style: { ...ORIGINAL_DEFAULT, ...j.style } };
        setPresets((ps) => [...ps, p]); setActivePresetId(p.id); flash(`Imported “${p.name}”`);
      } catch { flash("That file isn’t a valid CaptionForge preset"); }
    };
    r.readAsText(file);
  }

  function download(name: string, text: string, type = "application/json") {
    const blob = new Blob([text], { type });
    downloadBlob(name, blob);
  }
  function downloadBlob(name: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  function exportSRT() {
    const srt = segments.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`).join("\n");
    download("captions.srt", srt, "text/plain");
  }
  function exportProject() {
    download("project.cfproj.json", JSON.stringify({
      kind: "captionforge-project", presets, defaultId, applyDefaultToNew,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      segments: segments.map(({ id: _id, ...r }) => r), video: video ? { name: video.name, duration: video.duration } : null,
    }, null, 2), "application/json");
  }

  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStatus, setRenderStatus] = useState("");
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(null);
  const cancelRenderRef = useRef(false);
  const renderedVideoUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (renderedVideoUrlRef.current) URL.revokeObjectURL(renderedVideoUrlRef.current);
  }, []);

  // Word-wrap text to a max pixel width, capped at maxLines.
  function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur);
        cur = w;
        if (lines.length >= maxLines) break;
      } else {
        cur = test;
      }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    return lines.length ? lines : [text];
  }

  // Draw one caption onto the export canvas at native resolution. Uses a real
  // canvas text stroke for the outline (not a shadow), mirroring the preview.
  function drawCaptionToCanvas(
    ctx: CanvasRenderingContext2D, W: number, H: number, seg: Segment, style: SubtitleStyle, t: number
  ) {
    const text = applyCaps(seg.text, style.caps);
    const fontPx = (style.fontSizePct / 100) * H;
    const outlinePx = (style.outlineWidthPct / 100) * fontPx;
    const fam = style.customFontName || style.fontFamily;
    ctx.font = `${style.italic ? "italic " : ""}${style.bold ? "800" : "500"} ${fontPx}px '${fam}', sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = style.align as CanvasTextAlign;
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;

    const maxW = (style.maxWidthPct / 100) * W;
    const lines = wrapLines(ctx, text, maxW, style.maxLines || 2);
    const lineH = fontPx * style.lineSpacing;
    const cx = (style.x / 100) * W;
    const cy = (style.y / 100) * H;
    const startY = cy - ((lines.length - 1) * lineH) / 2;
    const anchorX = style.align === "left" ? cx - maxW / 2 : style.align === "right" ? cx + maxW / 2 : cx;

    // optional background box
    if (style.bgOpacity > 0) {
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const pad = style.bgPadding;
      const bw = widest + pad * 2;
      const bh = lines.length * lineH + pad * 2;
      ctx.fillStyle = hexA(style.bgColor, style.bgOpacity);
      const bx = cx - bw / 2;
      const by = startY - lineH / 2 - pad;
      const r = style.cornerRadius;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, r);
      ctx.fill();
    }

    lines.forEach((line, i) => {
      const y = startY + i * lineH;
      // shadow
      if (style.shadowBlur > 0 || style.shadowDistance > 0) {
        ctx.save();
        ctx.shadowColor = hexA(style.shadowColor, style.shadowOpacity);
        ctx.shadowBlur = style.shadowBlur;
        ctx.shadowOffsetX = style.shadowDistance;
        ctx.shadowOffsetY = style.shadowDistance;
        ctx.fillStyle = style.color;
        ctx.fillText(line, anchorX, y);
        ctx.restore();
      }
      // real outline stroke (drawn outer, doubled because stroke is centred)
      if (outlinePx > 0) {
        ctx.lineWidth = outlinePx * 2;
        ctx.strokeStyle = hexA(style.outlineColor, style.outlineOpacity);
        ctx.strokeText(line, anchorX, y);
      }
      // fill (with per-word highlight for word/karaoke animations)
      const isHL = style.animation === "wordHighlight" || style.animation === "karaoke";
      if (isHL && lines.length === 1) {
        const words = line.split(/\s+/);
        const dur = Math.max(0.001, seg.end - seg.start);
        const active = Math.floor(clamp((t - seg.start) / dur, 0, 1) * words.length);
        let penX = style.align === "center" ? anchorX - ctx.measureText(line).width / 2 : anchorX;
        const prevAlign = ctx.textAlign;
        ctx.textAlign = "left";
        words.forEach((w, wi) => {
          ctx.fillStyle = wi <= active ? style.highlightColor : style.color;
          ctx.fillText(w, penX, y);
          penX += ctx.measureText(w + " ").width;
        });
        ctx.textAlign = prevAlign;
      } else {
        ctx.fillStyle = style.color;
        ctx.fillText(line, anchorX, y);
      }
    });
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  // Paint one frame (video + active caption) onto the export canvas.
  function paintFrame(ctx: CanvasRenderingContext2D, src: HTMLVideoElement, W: number, H: number, t: number) {
    ctx.drawImage(src, 0, 0, W, H);
    const active = segments.find((s) => t >= s.start && t < s.end);
    if (active) drawCaptionToCanvas(ctx, W, H, active, styleFor(active), t);
  }

  async function isSeekableVideo(blob: Blob): Promise<boolean> {
    const url = URL.createObjectURL(blob);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    probe.src = url;

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Metadata timeout")), 8_000);
        probe.onloadedmetadata = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        probe.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error("Video metadata could not be read"));
        };
      });
      if (!Number.isFinite(probe.duration) || probe.duration <= 0) return false;

      const target = Math.min(probe.duration * 0.6, Math.max(0, probe.duration - 0.05));
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Seek timeout")), 8_000);
        probe.onseeked = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        probe.currentTime = target;
      });
      return Math.abs(probe.currentTime - target) < 0.5;
    } catch {
      return false;
    } finally {
      probe.removeAttribute("src");
      probe.load();
      URL.revokeObjectURL(url);
    }
  }

  async function renderVideo() {
    if (!video) return;
    setRendering(true);
    setRenderError(null);
    setRenderProgress(1);
    setRenderStatus("Preparing MP4 export…");
    cancelRenderRef.current = false;

    const src = document.createElement("video");
    src.preload = "auto";
    src.muted = true;
    (src as any).playsInline = true;
    const canvas = document.createElement("canvas");

    try {
      const saveFinishedVideo = async (blob: Blob) => {
        if (renderedVideoUrlRef.current) URL.revokeObjectURL(renderedVideoUrlRef.current);
        const url = URL.createObjectURL(blob);
        renderedVideoUrlRef.current = url;
        setRenderedVideoUrl(url);
        const a = document.createElement("a");
        a.href = url;
        a.download = "captionforge.mp4";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
      };

      await document.fonts.ready;
      await new Promise<void>((resolve, reject) => {
        src.onloadedmetadata = () => resolve();
        src.onerror = () => reject(new Error("Could not read the video for export"));
        src.src = video.url;
        if (src.readyState >= HTMLMediaElement.HAVE_METADATA) resolve();
      });

      // Export at 1080p for the clip's orientation while preserving its aspect
      // ratio: landscape fits 1920x1080, portrait fits 1080x1920, and square
      // exports at 1080x1080. Smaller sources are upscaled to the 1080p frame.
      const maxW = video.w >= video.h ? 1920 : 1080;
      const maxH = video.w >= video.h ? 1080 : 1920;
      const scale = Math.min(maxW / video.w, maxH / video.h);
      const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
      const W = even(video.w), H = even(video.h);
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | null;
      if (!ctx) throw new Error("Canvas 2D context unavailable in this browser");

      const fps = 60;
      const duration = video.duration;
      const frameCount = Math.max(1, Math.ceil(duration * fps));
      const frameDurationUs = Math.round(1_000_000 / fps);
      const videoBitsPerSecond = Math.min(
        32_000_000,
        Math.max(16_000_000, Math.round(W * H * fps * 0.16))
      );

      const VideoEncoderCtor = (window as any).VideoEncoder;
      const VideoFrameCtor = (window as any).VideoFrame;
      const AudioEncoderCtor = (window as any).AudioEncoder;
      const AudioDataCtor = (window as any).AudioData;
      if (!VideoEncoderCtor || !VideoFrameCtor) {
        throw new Error("1080p60 export requires the latest Chrome or Edge.");
      }

      const codecCandidates = ["avc1.64002a", "avc1.4d402a", "avc1.42002a"];
      let videoCodec = "";
      let hardwareAcceleration: "prefer-hardware" | "no-preference" = "prefer-hardware";
      for (const acceleration of ["prefer-hardware", "no-preference"] as const) {
        for (const codec of codecCandidates) {
          const support = await VideoEncoderCtor.isConfigSupported({
            codec, width: W, height: H, bitrate: videoBitsPerSecond, framerate: fps,
            hardwareAcceleration: acceleration,
            avc: { format: "avc" },
          });
          if (support.supported) {
            videoCodec = codec;
            hardwareAcceleration = acceleration;
            break;
          }
        }
        if (videoCodec) break;
      }
      if (!videoCodec) throw new Error("This browser has no H.264 encoder for 1080p60.");

      // Decode the original audio before frame seeking. If the browser cannot
      // decode this container's audio, export remains valid but video-only.
      let decodedAudio: AudioBuffer | null = null;
      if (AudioEncoderCtor && AudioDataCtor) {
        try {
          setRenderStatus("Preparing original audio…");
          const audioContext = new AudioContext();
          decodedAudio = await audioContext.decodeAudioData(await video.file.arrayBuffer());
          await audioContext.close();
        } catch { decodedAudio = null; }
      }

      const audioFramesPerChunk = 1024;
      const audioFrameCount = decodedAudio
        ? Math.min(decodedAudio.length, Math.ceil(duration * decodedAudio.sampleRate))
        : 0;
      const expectedAudioChunks = decodedAudio ? Math.ceil(audioFrameCount / audioFramesPerChunk) : 0;

      const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        video: { codec: "avc", width: W, height: H, frameRate: fps },
        ...(decodedAudio ? {
          audio: {
            codec: "aac" as const,
            numberOfChannels: decodedAudio.numberOfChannels,
            sampleRate: decodedAudio.sampleRate,
          },
        } : {}),
        fastStart: {
          expectedVideoChunks: frameCount,
          ...(decodedAudio ? { expectedAudioChunks } : {}),
        },
      });

      let encoderError: Error | null = null;
      const videoEncoder = new VideoEncoderCtor({
        output: (chunk: EncodedVideoChunk, meta: EncodedVideoChunkMetadata) => {
          muxer.addVideoChunk(chunk, meta);
        },
        error: (error: DOMException) => { encoderError = new Error(error.message); },
      });
      videoEncoder.configure({
        codec: videoCodec,
        width: W,
        height: H,
        bitrate: videoBitsPerSecond,
        framerate: fps,
        hardwareAcceleration,
        latencyMode: "quality",
        avc: { format: "avc" },
      });

      setRenderStatus("Encoding every frame at 1080p 60 FPS…");
      src.currentTime = 0;
      let outputFrameIndex = 0;
      let lastMediaTime = 0;
      const encodeCurrentCanvas = () => {
        const frame = new VideoFrameCtor(canvas, {
          timestamp: outputFrameIndex * frameDurationUs,
          duration: frameDurationUs,
        });
        videoEncoder.encode(frame, { keyFrame: outputFrameIndex % (fps * 2) === 0 });
        frame.close();
        outputFrameIndex++;
      };

      await new Promise<void>((resolve, reject) => {
        let finished = false;
        let processing = false;
        const finish = async () => {
          if (finished) return;
          finished = true;
          try {
            // Extend the final decoded source frame to the exact clip duration.
            while (outputFrameIndex < frameCount) encodeCurrentCanvas();
            await videoEncoder.flush();
            resolve();
          } catch (error) {
            reject(error);
          }
        };
        const onEnded = () => {
          if (!processing) void finish();
        };
        const onFrame = async (_now: number, metadata: VideoFrameCallbackMetadata) => {
          if (finished) return;
          processing = true;
          try {
            if (cancelRenderRef.current) {
              src.pause();
              await finish();
              return;
            }
            lastMediaTime = Math.max(lastMediaTime, metadata.mediaTime);
            paintFrame(ctx, src, W, H, lastMediaTime);

            // Duplicate each decoded source frame only as needed to populate the
            // fixed 60 FPS timeline. Every encoded timestamp is contiguous.
            const framesDue = Math.min(
              frameCount,
              Math.floor((lastMediaTime + 1 / fps) * fps)
            );
            while (outputFrameIndex < framesDue) encodeCurrentCanvas();

            if (videoEncoder.encodeQueueSize > 8) {
              src.pause();
              await videoEncoder.flush();
              if (!src.ended && !cancelRenderRef.current) await src.play();
            }
            if (encoderError) throw encoderError;
            setRenderProgress(Math.min(85, Math.round((outputFrameIndex / frameCount) * 85)));
            processing = false;
            if (src.ended || outputFrameIndex >= frameCount) {
              await finish();
            } else {
              src.requestVideoFrameCallback(onFrame);
            }
          } catch (error) {
            finished = true;
            reject(error);
          }
        };
        src.addEventListener("ended", onEnded, { once: true });
        src.requestVideoFrameCallback(onFrame);
        src.play().catch(reject);
      });
      if (cancelRenderRef.current) { flash("Export cancelled"); return; }
      await videoEncoder.flush();
      videoEncoder.close();
      if (encoderError) throw encoderError;

      if (decodedAudio && audioFrameCount > 0) {
        setRenderStatus("Encoding original audio…");
        let audioEncoderError: Error | null = null;
        const audioEncoder = new AudioEncoderCtor({
          output: (chunk: EncodedAudioChunk, meta: EncodedAudioChunkMetadata) => {
            muxer.addAudioChunk(chunk, meta);
          },
          error: (error: DOMException) => { audioEncoderError = new Error(error.message); },
        });
        const audioConfig = {
          codec: "mp4a.40.2",
          sampleRate: decodedAudio.sampleRate,
          numberOfChannels: decodedAudio.numberOfChannels,
          bitrate: 192_000,
        };
        const audioSupport = await AudioEncoderCtor.isConfigSupported(audioConfig);
        if (!audioSupport.supported) throw new Error("This browser cannot encode AAC audio.");
        audioEncoder.configure(audioConfig);

        for (let offset = 0; offset < audioFrameCount; offset += audioFramesPerChunk) {
          if (cancelRenderRef.current) { flash("Export cancelled"); return; }
          const frames = Math.min(audioFramesPerChunk, audioFrameCount - offset);
          const planar = new Float32Array(frames * decodedAudio.numberOfChannels);
          for (let channel = 0; channel < decodedAudio.numberOfChannels; channel++) {
            planar.set(
              decodedAudio.getChannelData(channel).subarray(offset, offset + frames),
              channel * frames
            );
          }
          const audioData = new AudioDataCtor({
            format: "f32-planar",
            sampleRate: decodedAudio.sampleRate,
            numberOfFrames: frames,
            numberOfChannels: decodedAudio.numberOfChannels,
            timestamp: Math.round((offset / decodedAudio.sampleRate) * 1_000_000),
            data: planar,
          });
          audioEncoder.encode(audioData);
          audioData.close();
          if (audioEncoder.encodeQueueSize > 12) await audioEncoder.flush();
          if (audioEncoderError) throw audioEncoderError;
        }
        await audioEncoder.flush();
        audioEncoder.close();
        if (audioEncoderError) throw audioEncoderError;
      }

      setRenderStatus("Finalizing seekable MP4…");
      muxer.finalize();
      const blob = new Blob([target.buffer], { type: "video/mp4" });
      if (!(await isSeekableVideo(blob))) throw new Error("The finished MP4 failed seek validation.");

      setRenderProgress(100);
      setRenderStatus("Saving MP4…");
      await saveFinishedVideo(blob);
      setRenderStatus("");
      flash("MP4 export complete");
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        flash("Export cancelled");
        return;
      }
      const message = err instanceof Error ? err.message : "Export failed";
      setRenderError(message);
      flash("Export stopped — see the error message at the top");
    } finally {
      setRendering(false);
      setRenderStatus("");
      src.removeAttribute("src");
      src.load();
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  function cancelRender() {
    cancelRenderRef.current = true;
  }

  // ---- drag caption around the preview ----
  function onPreviewPointerDown() {
    if (locked || !activeSeg || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    dragRef.current = { id: activeSeg.id, rect };
    window.addEventListener("pointermove", onPreviewPointerMove);
    window.addEventListener("pointerup", onPreviewPointerUp);
  }
  function onPreviewPointerMove(e: PointerEvent) {
    const d = dragRef.current; if (!d) return;
    const x = clamp(((e.clientX - d.rect.left) / d.rect.width) * 100, 0, 100);
    const y = clamp(((e.clientY - d.rect.top) / d.rect.height) * 100, 0, 100);
    setPresets((ps) => ps.map((p) => p.id === activePresetId ? { ...p, style: { ...p.style, x: Math.round(x), y: Math.round(y) } } : p));
  }
  function onPreviewPointerUp() {
    dragRef.current = null;
    window.removeEventListener("pointermove", onPreviewPointerMove);
    window.removeEventListener("pointerup", onPreviewPointerUp);
  }

  function seekTo(t: number) {
    setCurrentTime(t);
    if (videoRef.current) videoRef.current.currentTime = t;
  }

  const aspect = video ? `${video.w}:${video.h}` : "16:9";
  const styleP = activePreset.style;
  const setS = patchActivePreset;

  // -------------------------------------------------------------------------
  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh", fontFamily: "Inter, system-ui, sans-serif", fontSize: 14 }}>
      <style>{CSS}</style>

      {/* tiny-screen note */}
      <div className="cf-small-note" style={{ display: "none", padding: 18, textAlign: "center", color: C.dim }}>
        CaptionForge is built for detailed editing — open it on a desktop or tablet for the full workspace.
      </div>

      <div className="cf-app">
        {/* ============ top bar ============ */}
        <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 18px", borderBottom: `1px solid ${C.line}`, background: C.bg2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: C.amber, display: "grid", placeItems: "center", boxShadow: `0 0 22px ${hexA(C.amber, 0.4)}` }}>
              <Type size={17} color="#1a1300" strokeWidth={2.6} />
            </div>
            <div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: "-.3px" }}>
                Caption<span style={{ color: C.amber }}>Forge</span>
              </div>
            </div>
          </div>

          <div style={{ flex: 1 }} />

          {/* Auto-generate + preset dropdown */}
          <div style={{ position: "relative" }}>
            <div style={{ display: "flex", alignItems: "stretch", borderRadius: 10, overflow: "hidden", border: `1px solid ${C.amber}` }}>
              <button onClick={() => autoGenerate()} disabled={!video || transcribing} style={{
                display: "flex", alignItems: "center", gap: 7, padding: "9px 14px", background: C.amber,
                border: "none", color: "#1a1300", fontWeight: 700, fontSize: 13, cursor: (video && !transcribing) ? "pointer" : "not-allowed", opacity: (video && !transcribing) ? 1 : 0.5,
              }}>
                <Wand2 size={15} /> {transcribing ? "Transcribing…" : "Auto Generate Subtitles"}
              </button>
              <button onClick={() => setAutoOpen((o) => !o)} style={{ padding: "0 9px", background: hexA(C.amber, 0.18), border: "none", borderLeft: `1px solid ${hexA('#1a1300',0.25)}`, color: "#1a1300", cursor: "pointer" }}>
                <ChevronDown size={15} />
              </button>
            </div>
            {autoOpen && (
              <div style={{ position: "absolute", right: 0, top: 46, width: 320, background: C.panel, border: `1px solid ${C.line2}`, borderRadius: 12, padding: 10, zIndex: 40, boxShadow: "0 18px 50px rgba(0,0,0,.55)" }}>
                <div style={{ fontSize: 11, color: C.dim, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", padding: "4px 6px 8px" }}>Style to apply</div>
                <button onClick={() => setAutoChoiceId("__default__")} style={rowStyle(autoChoiceId === "__default__")}>
                  <Star size={14} color={C.amber} fill={C.amber} />
                  <span style={{ flex: 1, textAlign: "left" }}>Use my default preset</span>
                  <span style={{ fontSize: 11, color: C.faint }}>{presets.find((p) => p.id === defaultId)?.name}</span>
                </button>
                <div style={{ height: 1, background: C.line, margin: "6px 0" }} />
                <div style={{ maxHeight: 240, overflow: "auto" }}>
                  {presets.map((p) => (
                    <button key={p.id} onClick={() => setAutoChoiceId(p.id)} style={rowStyle(autoChoiceId === p.id)}>
                      <span style={{ flex: 1, textAlign: "left" }}>{p.name}</span>
                      {p.id === defaultId && <Star size={12} color={C.amber} fill={C.amber} />}
                      {autoChoiceId === p.id && <Check size={14} color={C.amber} />}
                    </button>
                  ))}
                </div>
                <div style={{ padding: 8, marginTop: 6, background: C.bg2, borderRadius: 9 }}>
                  <div style={{ fontSize: 10.5, color: C.faint, marginBottom: 6, fontWeight: 600 }}>LIVE PREVIEW</div>
                  <PresetThumb style={resolvedAutoPreset.style} />
                </div>
              </div>
            )}
          </div>

          <Btn kind="ghost" onClick={exportProject} title="Export the project (presets + captions) as JSON"><Download size={14} /> Save project</Btn>
          {rendering ? (
            <Btn kind="danger" onClick={cancelRender} title={renderStatus || "Rendering"}><X size={14} /> Cancel ({renderProgress}%)</Btn>
          ) : (
            <Btn kind="solid" onClick={renderVideo} disabled={!video || segments.length === 0} title="Burn captions into the video in your browser and download an MP4 (falls back to WebM on browsers without WebCodecs)">
              <Film size={14} /> Render &amp; Download
            </Btn>
          )}
        </header>

        {/* ============ body ============ */}
        <div className="cf-body">
          {/* ---------- LEFT: captions + fonts ---------- */}
          <aside className="cf-left" style={{ background: C.bg2, borderRight: `1px solid ${C.line}` }}>
            <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 8 }}>
              <Layers size={15} color={C.amber} />
              <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>Captions</span>
              <Btn onClick={addSeg} title="Add caption at playhead"><Plus size={13} /></Btn>
            </div>

            {/* search & replace */}
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.line}`, display: "flex", gap: 6 }}>
              <input placeholder="Find" value={search} onChange={(e) => setSearch(e.target.value)} style={inp()} />
              <input placeholder="Replace" value={replace} onChange={(e) => setReplace(e.target.value)} style={inp()} />
              <Btn onClick={applySearchReplace} title="Replace in all captions"><Search size={13} /></Btn>
            </div>

            <div style={{ display: "flex", gap: 6, padding: "8px 14px", borderBottom: `1px solid ${C.line}` }}>
              <Btn onClick={undo} title="Undo"><RotateCcw size={13} /></Btn>
              <Btn onClick={redo} title="Redo" style={{ transform: "scaleX(-1)" }}><RotateCcw size={13} /></Btn>
              <div style={{ flex: 1 }} />
              <Btn onClick={exportSRT} title="Export SRT"><FileDown size={13} /> SRT</Btn>
              <label><Btn title="Import SRT/VTT"><FileUp size={13} /></Btn>
                <input type="file" accept=".srt,.vtt" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => autoGenerate(typeof r.result === "string" ? r.result : undefined); r.readAsText(f); } }} />
              </label>
            </div>

            {/* caption list */}
            <div className="cf-scroll" style={{ flex: 1, overflow: "auto", padding: 10 }}>
              {segments.length === 0 && (
                <div style={{ textAlign: "center", color: C.faint, fontSize: 12.5, padding: "40px 12px", lineHeight: 1.6 }}>
                  No captions yet.<br />Upload a video and hit <b style={{ color: C.amber }}>Auto Generate Subtitles</b>, or import an SRT.
                </div>
              )}
              {segments.map((s, i) => {
                const active = activeSeg?.id === s.id;
                const sel = selectedSeg === s.id;
                const overridden = !!s.styleOverride;
                return (
                  <div key={s.id} onClick={() => { setSelectedSeg(s.id); seekTo(s.start); }}
                    style={{
                      background: active ? hexA(C.amber, 0.12) : sel ? C.panel : C.panel, borderRadius: 10, padding: 10, marginBottom: 8,
                      border: `1px solid ${active ? C.amber : sel ? C.line2 : C.line}`, cursor: "pointer", transition: "border .12s",
                    }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: C.faint, fontVariantNumeric: "tabular-nums" }}>#{i + 1}</span>
                      <input value={fmt(s.start)} readOnly style={timeChip()} title="Start" />
                      <span style={{ color: C.faint }}>→</span>
                      <input value={fmt(s.end)} readOnly style={timeChip()} title="End" />
                      {overridden && <span title="Custom style on this caption" style={{ marginLeft: "auto", fontSize: 9.5, color: C.mint, fontWeight: 700, border: `1px solid ${hexA(C.mint,0.4)}`, borderRadius: 5, padding: "1px 5px" }}>EDITED</span>}
                    </div>
                    <textarea value={s.text} onChange={(e) => editText(s.id, e.target.value)} onClick={(e) => e.stopPropagation()} rows={2}
                      style={{ width: "100%", background: C.bg2, border: `1px solid ${C.line}`, borderRadius: 7, color: C.text, padding: "7px 8px", fontSize: 13, resize: "vertical", lineHeight: 1.4 }} />
                    <div style={{ display: "flex", gap: 4, marginTop: 7 }}>
                      <MiniBtn onClick={(e) => { e.stopPropagation(); seekTo(s.start); }} icon={<Play size={12} />} title="Go to" />
                      <MiniBtn onClick={(e) => { e.stopPropagation(); splitSeg(s.id); }} icon={<Split size={12} />} title="Split" />
                      <MiniBtn onClick={(e) => { e.stopPropagation(); mergeNext(s.id); }} icon={<Merge size={12} />} title="Merge next" />
                      <MiniBtn onClick={(e) => { e.stopPropagation(); dupSeg(s.id); }} icon={<Copy size={12} />} title="Duplicate" />
                      <div style={{ flex: 1 }} />
                      <MiniBtn onClick={(e) => { e.stopPropagation(); delSeg(s.id); }} icon={<Trash2 size={12} />} title="Delete" danger />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* fonts */}
            <div style={{ borderTop: `1px solid ${C.line}`, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Type size={14} color={C.amber} />
                <span style={{ fontWeight: 700, fontSize: 12.5, flex: 1 }}>Custom fonts</span>
                <label><Btn title="Upload .ttf/.otf/.woff"><Plus size={13} /></Btn>
                  <input type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={(e) => loadFont(e.target.files?.[0])} />
                </label>
              </div>
              {customFonts.length === 0
                ? <div style={{ fontSize: 11.5, color: C.faint }}>Upload your brand fonts — they appear in the picker instantly.</div>
                : customFonts.map((f) => <div key={f.name} style={{ fontSize: 12.5, padding: "4px 0", fontFamily: `'${f.name}'` }}>{f.name}</div>)}
            </div>
          </aside>

          {/* ---------- CENTRE: preview ---------- */}
          <main className="cf-centre" style={{ background: C.bg, display: "flex", flexDirection: "column" }}>
            <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 22, position: "relative" }}>
              {!video ? (
                <Dropzone onFile={loadVideo} />
              ) : (
                <div ref={previewRef} onPointerDown={onPreviewPointerDown}
                  style={{ position: "relative", maxWidth: "100%", maxHeight: "100%", borderRadius: 14, overflow: "hidden", boxShadow: "0 24px 70px rgba(0,0,0,.6)", aspectRatio: `${video.w}/${video.h}`, background: "#000" }}>
                  <video ref={videoRef} src={video.url} style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }}
                    onClick={() => setPlaying((p) => !p)} onLoadedMetadata={(e) => setPreviewH((e.target as HTMLVideoElement).clientHeight)} />
                  {/* safe area guides */}
                  {showSafe && (
                    <div style={{ position: "absolute", inset: "5% 5%", border: `1px dashed ${hexA(C.mint, 0.4)}`, borderRadius: 6, pointerEvents: "none" }}>
                      <div style={{ position: "absolute", left: 0, right: 0, top: "50%", borderTop: `1px dashed ${hexA(C.mint,0.2)}` }} />
                    </div>
                  )}
                  {/* active caption */}
                  {activeSeg && <CaptionLayer seg={activeSeg} style={styleFor(activeSeg)} previewH={previewH} currentTime={currentTime} dragging={!!dragRef.current} />}
                  {locked && <div style={{ position: "absolute", top: 10, left: 10, background: hexA("#000", 0.6), borderRadius: 7, padding: "4px 8px", fontSize: 11, display: "flex", gap: 5, alignItems: "center" }}><Lock size={11} /> Position locked</div>}
                </div>
              )}
            </div>

            {/* transport */}
            {video && (
              <div style={{ padding: "10px 18px 14px", borderTop: `1px solid ${C.line}`, background: C.bg2 }}>
                <input type="range" className="cf-range cf-scrub" min={0} max={video.duration} step={0.01} value={currentTime}
                  onChange={(e) => seekTo(parseFloat(e.target.value))} style={{ width: "100%", marginBottom: 8 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button onClick={() => seekTo(Math.max(0, currentTime - 1 / 30))} style={transBtn()} title="Step back">‹</button>
                  <button onClick={() => setPlaying((p) => !p)} style={{ ...transBtn(), background: C.amber, color: "#1a1300", width: 40, height: 40 }}>
                    {playing ? <Pause size={18} /> : <Play size={18} />}
                  </button>
                  <button onClick={() => seekTo(Math.min(video.duration, currentTime + 1 / 30))} style={transBtn()} title="Step forward">›</button>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 13, color: C.dim }}>{fmt(currentTime)} <span style={{ color: C.faint }}>/ {fmt(video.duration)}</span></span>
                  <div style={{ flex: 1 }} />
                  <Btn onClick={() => setShowSafe((s) => !s)} title="Safe-area guides">{showSafe ? <Eye size={13} /> : <EyeOff size={13} />} Safe</Btn>
                  <Btn onClick={() => setLocked((l) => !l)} title="Lock caption position">{locked ? <Lock size={13} /> : <Unlock size={13} />}</Btn>
                </div>
                {/* timeline */}
                <div style={{ marginTop: 12, position: "relative", height: 34, background: C.bg, borderRadius: 8, border: `1px solid ${C.line}`, overflow: "hidden" }}>
                  {segments.map((s) => (
                    <div key={s.id} onClick={() => { setSelectedSeg(s.id); seekTo(s.start); }} title={s.text}
                      style={{ position: "absolute", top: 5, height: 24, left: `${(s.start / video.duration) * 100}%`, width: `${Math.max(1.5, ((s.end - s.start) / video.duration) * 100)}%`, background: activeSeg?.id === s.id ? C.amber : C.panel2, border: `1px solid ${activeSeg?.id === s.id ? C.amber : C.line2}`, borderRadius: 5, cursor: "pointer", overflow: "hidden", fontSize: 9, color: activeSeg?.id === s.id ? "#1a1300" : C.dim, padding: "2px 4px", whiteSpace: "nowrap" }}>
                      {s.text}
                    </div>
                  ))}
                  <div style={{ position: "absolute", top: 0, bottom: 0, width: 2, background: C.pink, left: `${(currentTime / video.duration) * 100}%`, pointerEvents: "none" }} />
                </div>
              </div>
            )}

            {video && (
              <div style={{ display: "flex", gap: 18, padding: "8px 18px 12px", fontSize: 11.5, color: C.faint, background: C.bg2, borderTop: `1px solid ${C.line}`, flexWrap: "wrap" }}>
                <span>{video.name}</span>
                <span>{(video.size / 1048576).toFixed(1)} MB</span>
                <span>{video.w}×{video.h}</span>
                <span>{aspect}</span>
                <span>{fmt(video.duration)}</span>
                <button onClick={() => { URL.revokeObjectURL(video.url); setVideo(null); setSegments([]); }} style={{ marginLeft: "auto", background: "none", border: "none", color: C.pink, cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>Remove video</button>
              </div>
            )}
          </main>

          {/* ---------- RIGHT: presets + style ---------- */}
          <aside className="cf-right" style={{ background: C.bg2, borderLeft: `1px solid ${C.line}`, overflow: "auto" }}>
            {/* PRESET MANAGER — the centrepiece */}
            <div style={{ padding: 16, borderBottom: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <Sparkles size={15} color={C.amber} />
                <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>Auto-subtitle presets</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                {presets.map((p) => {
                  const on = activePresetId === p.id;
                  const isDef = defaultId === p.id;
                  return (
                    <div key={p.id} onClick={() => setActivePresetId(p.id)}
                      style={{ background: on ? C.panel2 : C.panel, border: `1.5px solid ${on ? C.amber : C.line}`, borderRadius: 11, padding: 8, cursor: "pointer", position: "relative" }}>
                      {isDef && <div title="Default preset" style={{ position: "absolute", top: 6, right: 6, zIndex: 2 }}><Star size={13} color={C.amber} fill={C.amber} /></div>}
                      <PresetThumb style={p.style} />
                      {renameId === p.id ? (
                        <input autoFocus defaultValue={p.name} onBlur={(e) => { setPresets((ps) => ps.map((x) => x.id === p.id ? { ...x, name: e.target.value || x.name } : x)); setRenameId(null); }}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} onClick={(e) => e.stopPropagation()}
                          style={{ width: "100%", marginTop: 7, background: C.bg2, border: `1px solid ${C.amber}`, borderRadius: 6, color: C.text, padding: "3px 6px", fontSize: 12 }} />
                      ) : (
                        <div onDoubleClick={() => setRenameId(p.id)} style={{ marginTop: 7, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", overflow: "hidden" }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* preset actions */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                <Btn onClick={newPreset}><Plus size={12} /> New</Btn>
                <Btn onClick={dupPreset}><Copy size={12} /> Duplicate</Btn>
                <Btn onClick={() => setRenameId(activePresetId)}><Pencil size={12} /> Rename</Btn>
                <Btn kind="danger" onClick={() => delPreset(activePresetId)}><Trash2 size={12} /> Delete</Btn>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                <Btn onClick={() => exportPreset(activePreset)}><FileDown size={12} /> Export JSON</Btn>
                <label><Btn><FileUp size={12} /> Import</Btn><input type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importPreset(f); }} /></label>
                <Btn onClick={resetOriginal}><RotateCcw size={12} /> Reset original</Btn>
              </div>

              <Btn kind="solid" onClick={saveAsDefault} style={{ width: "100%", justifyContent: "center", marginBottom: 10 }}>
                <Star size={14} /> Save “{activePreset.name}” as Auto-Subtitle Default
              </Btn>

              <div style={{ background: C.panel, borderRadius: 9, padding: "8px 10px" }}>
                <Toggle on={applyDefaultToNew} onChange={setApplyDefaultToNew} label="Apply default preset to newly added subtitles" />
              </div>
            </div>

            {/* per-segment override controls */}
            {selectedSeg && segments.find((s) => s.id === selectedSeg) && (
              <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.line}`, background: hexA(C.mint, 0.05) }}>
                <div style={{ fontSize: 11, color: C.mint, fontWeight: 700, marginBottom: 8 }}>EDITING CAPTION #{segments.findIndex((s) => s.id === selectedSeg) + 1}</div>
                <div style={{ fontSize: 11.5, color: C.dim, marginBottom: 9, lineHeight: 1.5 }}>
                  Changing style below edits the <b style={{ color: C.text }}>{activePreset.name}</b> preset. To restyle only this caption or push to all, use:
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <Btn onClick={() => { const st = activePreset.style; patchSegStyle(selectedSeg, { color: st.color, fontFamily: st.fontFamily }); flash("Applied current preset look to this caption only"); }}>Apply to this only</Btn>
                  <Btn onClick={() => commit(segments.map((s) => ({ ...s, presetId: activePresetId, styleOverride: null })))}>Apply style to all</Btn>
                  <Btn onClick={() => { updateSeg(selectedSeg, { styleOverride: null }); flash("Reverted this caption to its preset"); }}>Clear override</Btn>
                </div>
              </div>
            )}

            {/* STYLE EDITOR (writes to active preset) */}
            <Section title="Text & font" icon={<Type size={14} color={C.amber} />}>
              <Field label="Font family">
                <select value={styleP.customFontName || styleP.fontFamily}
                  onChange={(e) => { const v = e.target.value; const isCustom = customFonts.some((f) => f.name === v); setS({ fontFamily: isCustom ? "Inter" : v, customFontName: isCustom ? v : null }); }}
                  style={selS()}>
                  <optgroup label="Built-in">{FONTS.map((f) => <option key={f} value={f}>{f}</option>)}</optgroup>
                  {customFonts.length > 0 && <optgroup label="Your fonts">{customFonts.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}</optgroup>}
                </select>
              </Field>
              <Field label="Font size" hint={`${styleP.fontSizePct.toFixed(1)}%`}><Slide value={styleP.fontSizePct} min={2} max={14} step={0.1} onChange={(v) => setS({ fontSizePct: v })} /></Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Text colour"><Color value={styleP.color} onChange={(v) => setS({ color: v })} /></Field>
                <Field label="Caps"><Seg options={CAPS} value={styleP.caps} onChange={(v) => setS({ caps: v as SubtitleStyle["caps"] })} /></Field>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 11 }}>
                <Btn kind={styleP.bold ? "solid" : "ghost"} onClick={() => setS({ bold: !styleP.bold })} style={{ flex: 1, justifyContent: "center" }}><b>B</b></Btn>
                <Btn kind={styleP.italic ? "solid" : "ghost"} onClick={() => setS({ italic: !styleP.italic })} style={{ flex: 1, justifyContent: "center" }}><i>I</i></Btn>
                <Seg options={[["left", <AlignLeft key="left" size={13} />], ["center", <AlignCenter key="center" size={13} />], ["right", <AlignRight key="right" size={13} />]]} value={styleP.align} onChange={(v) => setS({ align: v as SubtitleStyle["align"] })} />
              </div>
              <Field label="Letter spacing" hint={styleP.letterSpacing.toFixed(1)}><Slide value={styleP.letterSpacing} min={-2} max={8} step={0.1} onChange={(v) => setS({ letterSpacing: v })} /></Field>
              <Field label="Line spacing" hint={styleP.lineSpacing.toFixed(2)}><Slide value={styleP.lineSpacing} min={0.8} max={2} step={0.05} onChange={(v) => setS({ lineSpacing: v })} /></Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Words / line" hint={styleP.wordsPerSubtitle}><Slide value={styleP.wordsPerSubtitle} min={1} max={12} onChange={(v) => setS({ wordsPerSubtitle: v })} /></Field>
                <Field label="Max lines" hint={styleP.maxLines}><Slide value={styleP.maxLines} min={1} max={4} onChange={(v) => setS({ maxLines: v })} /></Field>
              </div>
            </Section>

            <Section title="Outline & shadow" icon={<Crosshair size={14} color={C.amber} />} defaultOpen={false}>
              <Field label="Outline colour"><Color value={styleP.outlineColor} onChange={(v) => setS({ outlineColor: v })} /></Field>
              <Field label="Outline thickness" hint={`${styleP.outlineWidthPct}% of size`}><Slide value={styleP.outlineWidthPct} min={0} max={16} step={0.5} onChange={(v) => setS({ outlineWidthPct: v })} /></Field>
              <Field label="Outline opacity" hint={styleP.outlineOpacity.toFixed(2)}><Slide value={styleP.outlineOpacity} min={0} max={1} step={0.05} onChange={(v) => setS({ outlineOpacity: v })} /></Field>
              <Field label="Shadow colour"><Color value={styleP.shadowColor} onChange={(v) => setS({ shadowColor: v })} /></Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Blur" hint={styleP.shadowBlur}><Slide value={styleP.shadowBlur} min={0} max={30} onChange={(v) => setS({ shadowBlur: v })} /></Field>
                <Field label="Distance" hint={styleP.shadowDistance}><Slide value={styleP.shadowDistance} min={0} max={20} onChange={(v) => setS({ shadowDistance: v })} /></Field>
              </div>
              <Field label="Shadow opacity" hint={styleP.shadowOpacity.toFixed(2)}><Slide value={styleP.shadowOpacity} min={0} max={1} step={0.05} onChange={(v) => setS({ shadowOpacity: v })} /></Field>
            </Section>

            <Section title="Background box" icon={<Layers size={14} color={C.amber} />} defaultOpen={false}>
              <Field label="Background colour"><Color value={styleP.bgColor} onChange={(v) => setS({ bgColor: v })} /></Field>
              <Field label="Background opacity" hint={styleP.bgOpacity.toFixed(2)}><Slide value={styleP.bgOpacity} min={0} max={1} step={0.05} onChange={(v) => setS({ bgOpacity: v })} /></Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Padding" hint={styleP.bgPadding}><Slide value={styleP.bgPadding} min={0} max={40} onChange={(v) => setS({ bgPadding: v })} /></Field>
                <Field label="Corner radius" hint={styleP.cornerRadius}><Slide value={styleP.cornerRadius} min={0} max={40} onChange={(v) => setS({ cornerRadius: v })} /></Field>
              </div>
            </Section>

            <Section title="Highlight & animation" icon={<Sparkles size={14} color={C.amber} />} defaultOpen={false}>
              <Field label="Highlighted word colour"><Color value={styleP.highlightColor} onChange={(v) => setS({ highlightColor: v })} /></Field>
              <Field label="Highlight background"><Color value={styleP.highlightBg} onChange={(v) => setS({ highlightBg: v })} /></Field>
              <Field label="Animation">
                <select value={styleP.animation} onChange={(e) => setS({ animation: e.target.value })} style={selS()}>
                  {ANIMATIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
            </Section>

            <Section title="Position & layout" icon={<Crosshair size={14} color={C.amber} />}>
              <div style={{ display: "flex", gap: 6, marginBottom: 11, flexWrap: "wrap" }}>
                {POS_PRESETS.map(([n, x, y]) => <Btn key={n} onClick={() => setS({ x, y })}>{n}</Btn>)}
              </div>
              <Field label="X position" hint={`${styleP.x}%`}><Slide value={styleP.x} min={0} max={100} onChange={(v) => setS({ x: v })} /></Field>
              <Field label="Y position" hint={`${styleP.y}%`}><Slide value={styleP.y} min={0} max={100} onChange={(v) => setS({ y: v })} /></Field>
              <Field label="Max width" hint={`${styleP.maxWidthPct}%`}><Slide value={styleP.maxWidthPct} min={20} max={100} onChange={(v) => setS({ maxWidthPct: v })} /></Field>
              <div style={{ display: "flex", gap: 6 }}>
                <Btn onClick={() => setS({ x: 50 })}><Crosshair size={12} /> Centre X</Btn>
                <Btn onClick={() => setS({ x: ORIGINAL_DEFAULT.x, y: ORIGINAL_DEFAULT.y })}><RotateCcw size={12} /> Reset</Btn>
              </div>
            </Section>

            <div style={{ padding: 14, fontSize: 11, color: C.faint, lineHeight: 1.6 }}>
              Position uses percentages so a preset looks identical across 9:16, 16:9 and 1:1 exports. In the Next.js build these same numbers feed FFmpeg <code>drawtext</code> / ASS during burn-in.
            </div>
          </aside>
        </div>
      </div>

      {rendering && renderStatus && (
        <div style={{ position: "fixed", top: 64, left: "50%", transform: "translateX(-50%)", background: hexA("#0a1a2a", 0.92), border: `1px solid ${C.blue}`, color: C.text, padding: "9px 16px", borderRadius: 10, fontSize: 12.5, zIndex: 89, maxWidth: 600, textAlign: "center" }}>
          {renderStatus} {renderProgress > 0 ? `(${renderProgress}%)` : ""}
        </div>
      )}
      {renderError && (
        <div style={{ position: "fixed", top: 64, left: "50%", transform: "translateX(-50%)", background: hexA("#3a1018", 0.92), border: `1px solid ${C.pink}`, color: C.text, padding: "9px 16px", borderRadius: 10, fontSize: 12.5, zIndex: 89, maxWidth: 600, textAlign: "center" }}>
          {renderError}
        </div>
      )}
      {renderedVideoUrl && !rendering && (
        <a
          href={renderedVideoUrl}
          download="captionforge.mp4"
          style={{ position: "fixed", top: renderError ? 110 : 64, left: "50%", transform: "translateX(-50%)", background: C.amber, color: "#1a1300", padding: "10px 18px", borderRadius: 10, fontSize: 13, fontWeight: 800, zIndex: 90, textDecoration: "none", boxShadow: "0 12px 36px rgba(0,0,0,.45)" }}
        >
          Download captionforge.mp4
        </a>
      )}
      {transcribeError && (
        <div style={{ position: "fixed", top: 64, left: "50%", transform: "translateX(-50%)", background: hexA("#000", 0.85), border: `1px solid ${C.line2}`, color: C.dim, padding: "9px 16px", borderRadius: 10, fontSize: 12.5, zIndex: 89, maxWidth: 560, textAlign: "center" }}>
          {transcribeError}
        </div>
      )}
      {toast && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: C.panel2, border: `1px solid ${C.amber}`, color: C.text, padding: "11px 18px", borderRadius: 11, fontSize: 13, fontWeight: 600, zIndex: 90, boxShadow: "0 14px 40px rgba(0,0,0,.5)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ---- helper components / styles ----
const MiniBtn = ({ onClick, icon, title, danger }: {
  onClick: (e: React.MouseEvent) => void; icon: React.ReactNode; title: string; danger?: boolean;
}) => (
  <button onClick={onClick} title={title} style={{ width: 26, height: 26, borderRadius: 7, background: C.bg2, border: `1px solid ${C.line}`, color: danger ? C.pink : C.dim, display: "grid", placeItems: "center", cursor: "pointer" }}>{icon}</button>
);

function Dropzone({ onFile }: { onFile: (f: File | undefined) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0]); }}
      style={{ width: "min(560px,90%)", padding: "56px 32px", borderRadius: 18, border: `2px dashed ${over ? C.amber : C.line2}`, background: over ? hexA(C.amber, 0.06) : C.bg2, display: "grid", placeItems: "center", gap: 14, cursor: "pointer", textAlign: "center", transition: ".15s" }}>
      <div style={{ width: 64, height: 64, borderRadius: 18, background: hexA(C.amber, 0.14), display: "grid", placeItems: "center" }}><Film size={30} color={C.amber} /></div>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 19, fontWeight: 700 }}>Drop a video to start</div>
      <div style={{ color: C.dim, fontSize: 13 }}>MP4 · MOV · WebM · AVI · MKV — your file stays in the browser</div>
      <span style={{ marginTop: 6, padding: "9px 18px", background: C.amber, color: "#1a1300", borderRadius: 10, fontWeight: 700, fontSize: 13, display: "inline-flex", gap: 7, alignItems: "center" }}><Upload size={15} /> Choose file</span>
      <input type="file" accept="video/*,.mkv,.avi" hidden onChange={(e) => onFile(e.target.files?.[0])} />
    </label>
  );
}

const inp = (): React.CSSProperties => ({ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 7, color: C.text, padding: "6px 8px", fontSize: 12 });
const selS = (): React.CSSProperties => ({ width: "100%", background: C.bg2, border: `1px solid ${C.line2}`, borderRadius: 8, color: C.text, padding: "8px 10px", fontSize: 13, cursor: "pointer" });
const timeChip = (): React.CSSProperties => ({ width: 62, background: C.bg2, border: `1px solid ${C.line}`, borderRadius: 5, color: C.dim, padding: "2px 5px", fontSize: 11, fontVariantNumeric: "tabular-nums", textAlign: "center" });
const transBtn = (): React.CSSProperties => ({ width: 32, height: 32, borderRadius: 9, background: C.panel2, border: `1px solid ${C.line2}`, color: C.text, display: "grid", placeItems: "center", cursor: "pointer", fontSize: 18 });
const rowStyle = (on: boolean): React.CSSProperties => ({ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 8px", borderRadius: 8, background: on ? hexA(C.amber, 0.12) : "transparent", border: "none", color: C.text, cursor: "pointer", fontSize: 13, fontWeight: 600 });

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&family=Anton&family=Bebas+Neue&family=Poppins:wght@500;700;800&family=Montserrat:wght@600;800&family=Oswald:wght@500;700&family=Archivo+Black&display=swap');
* { box-sizing: border-box; }
.cf-app { display: flex; flex-direction: column; height: 100vh; }
.cf-body { flex: 1; display: grid; grid-template-columns: 320px 1fr 340px; min-height: 0; }
.cf-left, .cf-right { display: flex; flex-direction: column; min-height: 0; }
.cf-scroll::-webkit-scrollbar, .cf-right::-webkit-scrollbar { width: 8px; }
.cf-scroll::-webkit-scrollbar-thumb, .cf-right::-webkit-scrollbar-thumb { background: ${C.line2}; border-radius: 8px; }
.cf-btn:hover { filter: brightness(1.12); }
textarea, input, select { outline: none; font-family: inherit; }
textarea:focus, input:focus, select:focus { border-color: ${C.amber} !important; }
.cf-range { -webkit-appearance: none; appearance: none; height: 5px; border-radius: 99px; background: ${C.line2}; }
.cf-range::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 99px; background: ${C.amber}; cursor: pointer; box-shadow: 0 0 0 4px ${hexA(C.amber, 0.18)}; }
.cf-range::-moz-range-thumb { width: 16px; height: 16px; border: none; border-radius: 99px; background: ${C.amber}; cursor: pointer; }
.cf-scrub::-webkit-slider-thumb { background: ${C.pink}; box-shadow: 0 0 0 4px ${hexA(C.pink,0.2)}; }
:focus-visible { outline: 2px solid ${C.amber}; outline-offset: 2px; }
@keyframes cf-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes cf-pop { 0% { transform: translate(-50%,-50%) scale(.6); opacity:0 } 60% { transform: translate(-50%,-50%) scale(1.08) } 100% { transform: translate(-50%,-50%) scale(1); opacity:1 } }
@keyframes cf-bounce { 0% { transform: translate(-50%,20%); opacity:0 } 60% { transform: translate(-50%,-58%) } 100% { transform: translate(-50%,-50%); opacity:1 } }
@keyframes cf-zoom { from { transform: translate(-50%,-50%) scale(1.8); opacity:0 } to { transform: translate(-50%,-50%) scale(1); opacity:1 } }
@keyframes cf-slideUp { from { transform: translate(-50%,10%); opacity:0 } to { transform: translate(-50%,-50%); opacity:1 } }
.cf-anim-fade { animation: cf-fade .35s ease both; }
.cf-anim-pop { animation: cf-pop .4s cubic-bezier(.3,1.5,.5,1) both; }
.cf-anim-bounce { animation: cf-bounce .5s cubic-bezier(.3,1.4,.5,1) both; }
.cf-anim-zoom { animation: cf-zoom .35s ease both; }
.cf-anim-slideUp { animation: cf-slideUp .35s ease both; }
@media (max-width: 1100px) { .cf-body { grid-template-columns: 280px 1fr; } .cf-right { display: none; } }
@media (max-width: 720px) { .cf-app { display: none; } .cf-small-note { display: block !important; } }
@media (prefers-reduced-motion: reduce) { [class^="cf-anim-"] { animation: none !important; } }
`;
