export type DownloadPlatform = "YouTube" | "TikTok" | "Twitch" | "Kick";

export function detectDownloadPlatform(value: string): DownloadPlatform | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com")) return "YouTube";
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "TikTok";
  if (host === "twitch.tv" || host.endsWith(".twitch.tv")) return "Twitch";
  if (host === "kick.com" || host.endsWith(".kick.com")) return "Kick";
  return null;
}

export function downloaderServiceUrl(): string {
  const configured = process.env.NEXT_PUBLIC_DOWNLOADER_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return "http://127.0.0.1:4317";
}
