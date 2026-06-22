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
  if (typeof window !== "undefined" && window.location.protocol === "http:") {
    return `http://${window.location.hostname}:4317`;
  }
  return "";
}

export function downloaderConnectionError(serviceUrl: string): string {
  if (!serviceUrl) {
    return "The deployed site needs an HTTPS downloader backend. Configure NEXT_PUBLIC_DOWNLOADER_API_URL before building.";
  }
  return `The downloader service at ${serviceUrl} is not reachable. Start it with "npm run downloader:server" and try again.`;
}
