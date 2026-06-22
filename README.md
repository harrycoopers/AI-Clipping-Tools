# CaptionForge

A browser-based subtitle & caption editor with a saveable **auto-subtitle preset
system**. It is a **fully static** Next.js app — it builds to a plain `out/`
folder of HTML/CSS/JS and runs entirely in the browser, so it can be hosted on
**GitHub Pages with no server**.

Live URL once deployed (your repo is `AI-Clipping-Tools`):
```
https://harrycoopers.github.io/AI-Clipping-Tools/
```

---

## What works today (verified)

- Video upload + preview, drag-to-position captions, full styling
- The auto-subtitle **preset system** (create / save / rename / duplicate /
  delete / set-default / reset / import / export JSON, the "Use my default
  preset" dropdown, per-segment overrides)
- Subtitle editing: add / delete / split / merge / duplicate, start/end times,
  search-and-replace, undo/redo, click-to-seek, active-caption highlight
- Real local Whisper transcription through Transformers.js in a Web Worker,
  with WebGPU-first execution, WASM fallback, word timestamps, readable cue
  splitting, cancellation, retry, model/language controls, and cached models
- Custom font upload (FontFace) **plus two bundled fonts**: Komika Axis and
  Montserrat ExtraBold (embedded as data URLs so they work offline and on Pages)
- **In-browser MP4 export** — captions are burned in with Canvas and encoded
  with WebCodecs into a fast-start, seek-validated MP4 that downloads locally.
- SRT/VTT import, SRT + project-JSON export
- Browser-local Portrait Gaming Layout with multi-frame webcam/gameplay
  detection, confidence review, manual source/destination correction, split
  and floating layouts, reusable layout presets, safe-area guides and true
  9:16 MP4 composition
- Auto-Subtitles opens directly, with an Auto Clips tool for Twitch/Kick VOD
  highlight detection and one-click subtitle handoff
- Clip Downloader is available again for supported video links
- Auto Clips ranks retrieved chat-reaction spikes when replay data is exposed
  by the platform extractor, with audio-reaction analysis as the fallback

## Browser requirements and limitations

- The first transcription needs internet access to download Transformers.js and
  the selected Whisper model. Browser caching avoids downloading it each time.
- WebGPU is attempted first. Unsupported GPUs/browsers automatically retry with
  WASM/CPU, which is slower.
- Accurate Whisper models can exceed memory on phones and low-memory computers;
  use the Fast model in that case.
- MP4 export requires WebCodecs H.264/AAC support. Current Chrome and Edge have
  the strongest support.

The AI Voiceover and Content Ideas sections are not built yet.

---

## Install & develop

```bash
npm install
npm run dev          # http://localhost:3000  (dev has no base path)
```

No environment variables or API keys are needed for the subtitle editor.

## Auto Clips media service

Auto Clips needs the local media service, `yt-dlp`, and FFmpeg:

```bash
npm run downloader:setup
npm run dev
```

On Windows, `downloader:setup` installs current official nightly builds into
the project's ignored `tools/` directory. `npm run dev` starts both Next.js and
the media service. Use `npm run dev:web` to start only the static frontend.
Auto Clips and Clip Downloader display a local-service warning because both
require `npm run dev`; browser-only Auto-Subtitles does not.


The local app connects to port `4317` by default. For a deployed frontend,
host the service separately over HTTPS and set `NEXT_PUBLIC_DOWNLOADER_API_URL`
before building. Download only content you own or have permission to use.

## Static build

```bash
npm run build        # produces ./out  (NODE_ENV=production adds the base path)
```

Confirm the export:
```bash
test -f out/index.html && echo OK
```

## Test the static build locally *at the Pages base path*

Because the production build prefixes assets with `/AI-Clipping-Tools/`, serving
`out/` at the root will 404 the assets. Replicate the Pages path:

```bash
rm -rf _preview && mkdir -p _preview/AI-Clipping-Tools
cp -r out/* _preview/AI-Clipping-Tools/
npx serve _preview          # then open http://localhost:3000/AI-Clipping-Tools/
```

(`npm start` runs `npx serve out`, which is fine for a quick look but loads at
the root, so some assets won't resolve — use the `_preview` method above to test
exactly as GitHub Pages serves it.)

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server (no base path) |
| `npm run build` | Static export to `out/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests |
| `npm run lint` | ESLint |
| `npm start` | `npx serve out` (quick local view) |

---

## Deploy to GitHub Pages (automatic)

This project lives in the `captionforge-app/` subfolder of the
`AI-Clipping-Tools` repo, and a GitHub Actions workflow
(`.github/workflows/deploy.yml`) builds and deploys it on every push to `main`.

One-time setup:

1. Commit and push (see below).
2. On GitHub: **Settings → Pages → Build and deployment → Source = GitHub
   Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab).
   The workflow checks out the repo, runs typecheck + tests + build, verifies
   `out/index.html`, and publishes to Pages.
4. Open `https://harrycoopers.github.io/AI-Clipping-Tools/`.

Push from the repo root:
```bash
git add .
git commit -m "Static export for GitHub Pages + bundled fonts"
git push
```

### Base-path configuration

The base path must equal the repository name. It is set in two places that must
match:

- `next.config.ts` → `repositoryName`
- `lib/basePath.ts` → `REPO_NAME`

Both are currently `AI-Clipping-Tools`. If you rename the repo (or move the app
to its own repo at the root), update both, and update the `working-directory`
and artifact `path` in `.github/workflows/deploy.yml` if the subfolder changes.

---

## How the bundled fonts work

`app/fonts.css` embeds **Komika Axis** (from your uploaded `KOMIKAX_.ttf`) and
**Montserrat ExtraBold** as base64 `@font-face` data URLs. Data URLs avoid all
base-path/asset-prefix issues, so the fonts render identically in dev, in the
static build, and on GitHub Pages. They appear at the top of the font selector.
Uploaded fonts (`.ttf/.otf/.woff/.woff2`) load at runtime via the FontFace API
and also work in the canvas export once `document.fonts.ready` resolves.

> Note: the `Montserrat_Extra_Bold.otf` you uploaded was actually an HTML error
> page (a failed download), so the bundled Montserrat is a genuine open-source
> Montserrat ExtraBold instead.

## Clearing local data

Projects/presets live in the browser. Use your browser's site-data controls
(DevTools → Application → Storage → Clear site data) to wipe them. Exported
project JSON is your portable backup.

## Troubleshooting

- **`npm run dev` opens an unrelated file / runs `live-server`** — you are in
  the wrong folder or a stray `package.json` is being used. Run `pwd` and
  confirm you are inside `captionforge-app`, and `Get-Content package.json` (or
  `cat package.json`) shows `"name": "captionforge-app"`.
- **Blank page or 404 assets on Pages** — confirm Pages Source is "GitHub
  Actions" and the repo name matches the base path in the two files above.
- **Export produces no sound** — your browser doesn't support capturing the
  video element's audio track; the video still exports.
