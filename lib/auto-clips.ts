export type AutoClipPlatform = "Twitch" | "Kick";

export interface HighlightSample {
  time: number;
  audio: number;
  chat?: number;
}

export interface HighlightCandidate {
  start: number;
  end: number;
  score: number;
  reason: string;
}

export function parseVodSource(value: string): { platform: AutoClipPlatform; channel: string } | null {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    if ((host === "twitch.tv" || host.endsWith(".twitch.tv")) && parts.length) {
      const channel = parts[0] === "videos" ? "" : parts[0];
      return channel ? { platform: "Twitch", channel } : { platform: "Twitch", channel: "" };
    }
    if ((host === "kick.com" || host.endsWith(".kick.com")) && parts.length) {
      return { platform: "Kick", channel: parts[0] };
    }
  } catch {
    return null;
  }
  return null;
}

export function rankHighlightWindows(
  samples: HighlightSample[],
  duration: number,
  options: { clipDuration?: number; maxClips?: number; separation?: number } = {}
): HighlightCandidate[] {
  const clipDuration = options.clipDuration ?? 30;
  const maxClips = options.maxClips ?? 8;
  const separation = options.separation ?? clipDuration * 0.8;
  if (!samples.length || duration <= 0) return [];

  const maxAudio = Math.max(...samples.map((sample) => sample.audio), 1);
  const maxChat = Math.max(...samples.map((sample) => sample.chat ?? 0), 1);
  const scored = samples.map((sample) => {
    const audio = sample.audio / maxAudio;
    const chat = (sample.chat ?? 0) / maxChat;
    return {
      ...sample,
      score: chat > 0 ? audio * 0.45 + chat * 0.55 : audio,
      reason: chat >= 0.65 ? "Chat activity spike" : "Audio reaction spike",
    };
  }).sort((a, b) => b.score - a.score);

  const selected: HighlightCandidate[] = [];
  for (const sample of scored) {
    if (selected.some((candidate) => Math.abs((candidate.start + candidate.end) / 2 - sample.time) < separation)) continue;
    const start = Math.max(0, Math.min(duration - clipDuration, sample.time - clipDuration * 0.45));
    const end = Math.min(duration, start + clipDuration);
    selected.push({ start, end, score: sample.score, reason: sample.reason });
    if (selected.length >= maxClips) break;
  }
  return selected.sort((a, b) => a.start - b.start);
}
