# CaptionForge

Automatic, editable subtitles and titles for your videos — with a saveable
**auto-subtitle preset system** so you never have to restyle captions after
every transcription.

Built with Next.js (App Router) + TypeScript + React. Subtitles are styled with
percentage-based layout so a preset looks identical across 9:16, 16:9 and 1:1,
and the same numbers drive server-side FFmpeg burn-in on export.

---

## Quick start (run locally)

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.example .env.local
#    then open .env.local and paste your OpenAI key (optional — see below)

# 3. Run the dev server
npm run dev
```

Open http://localhost:3000.

> **No API key?** The app still runs. "Auto Generate Subtitles" falls back to a
> timed demo split so you can test the preset system, editing, preview and SRT
> import/export. Add a key to transcribe real speech.

---

## Scripts

| Command            | What it does                                  |
| ------------------ | --------------------------------------------- |
| `npm run dev`      | Start the dev server (hot reload)             |
| `npm run build`    | Production build                              |
| `npm start`        | Run the production build                      |
| `npm run lint`     | ESLint                                        |
| `npm test`         | Run the Vitest unit tests once                |
| `npm run test:watch` | Run tests in watch mode                     |

---

## Folder structure

```
captionforge-app/
├─ app/
│  ├─ api/
│  │  ├─ transcribe/route.ts   # server-side speech-to-text (OpenAI Whisper)
│  │  └─ export/route.ts       # server-side FFmpeg subtitle burn-in
│  ├─ layout.tsx
│  ├─ page.tsx                 # renders the editor
│  └─ globals.css
├─ components/
│  └─ CaptionEditor.tsx        # the full editor UI + preset system (client)
├─ lib/
│  ├─ subtitles.ts             # pure, tested subtitle/preset logic
│  └─ subtitles.test.ts        # Vitest unit tests
├─ .env.example
└─ README.md
```

---

## Connecting the transcription provider

The transcription route uses **OpenAI Whisper** (`whisper-1`) by default.

1. Get a key from https://platform.openai.com.
2. Put it in `.env.local`:
   ```
   OPENAI_API_KEY=sk-...
   ```
3. Restart `npm run dev`.

The key is read **only** inside `app/api/transcribe/route.ts` (a server route)
and is never exposed to the browser. The route asks Whisper for word-level
timestamps and splits them into readable phrases using the preset's
"words per subtitle" setting.

To use a different provider (Deepgram, AssemblyAI, etc.), swap the `fetch` call
in `app/api/transcribe/route.ts` — keep it returning
`{ segments: { start, end, text }[] }` and the rest of the app is unchanged.

---

## FFmpeg setup (required for video export)

The export route (`/api/export`) shells out to **ffmpeg** and **ffprobe** to
burn captions into the video. Install FFmpeg and make sure it is on your `PATH`.
If it isn't installed, the export route returns a clear error and the rest of
the app keeps working.

**Windows**
```powershell
winget install Gyan.FFmpeg
# or with Chocolatey:
choco install ffmpeg
```
Then restart your terminal so `ffmpeg` is on PATH. Verify with `ffmpeg -version`.

**macOS** (Homebrew)
```bash
brew install ffmpeg
```

**Linux** (Debian/Ubuntu)
```bash
sudo apt update && sudo apt install -y ffmpeg
```
Fedora: `sudo dnf install ffmpeg`. Arch: `sudo pacman -S ffmpeg`.

Verify on any OS:
```bash
ffmpeg -version
ffprobe -version
```

---

## How uploaded fonts are used during rendering

In the browser preview, an uploaded font (`.ttf/.otf/.woff/.woff2`) is loaded
with the `FontFace` API and registered with `document.fonts`, so the caption
preview uses the real glyphs immediately.

For the final export, the same font file should be passed to FFmpeg's
`drawtext` filter via its `fontfile=` parameter (or registered through
`fontconfig`) so the burned-in captions match the preview exactly. The export
route is structured so the per-segment style — font size (as a % of the probed
video height), outline width, colour and percentage X/Y position — maps directly
onto `drawtext`. Wire the uploaded font path into that filter to preserve the
exact typeface in the rendered file.

---

## How emoji rendering works

Emoji in the preview use the browser's native colour-emoji font, so they look
correct while editing. Because servers often lack a colour-emoji font, reliable
burn-in needs one of:

- installing a colour-emoji font (e.g. Noto Color Emoji) on the render machine
  so FFmpeg/`libass` can rasterise it, or
- compositing emoji PNGs (transparent background, high resolution) as overlay
  images at the caption position.

This avoids the "missing square" problem. The app does **not** claim to use
Apple's proprietary emoji artwork unless the licensed Apple font is actually
present on the machine.

---

## The auto-subtitle preset system

- Presets store the full caption look (font, size, colour, outline, shadow,
  background, highlight, animation, capitalisation, position, words-per-line).
- Pick a preset from the dropdown next to **Auto Generate Subtitles**, or use
  **Use my default preset** (selected automatically).
- **Save as Auto-Subtitle Default** makes the current preset the default applied
  to every future generation.
- Editing the style panel edits the *active preset*. Editing a single caption's
  text never changes the preset; per-caption style overrides only affect that
  caption until you explicitly **Apply to all** or save a new preset.
- The built-in **Original default** is white, bold, thick black outline
  (~7% of font size), bottom-centre, no background box.

**Persistence note:** preset persistence is wired through React state plus
JSON **Export/Import** in this build. To persist across refreshes automatically,
add a `localStorage`/IndexedDB adapter that saves `{ presets, defaultId,
applyDefaultToNew }` — the data shape is already centralised in
`lib/subtitles.ts`.

---

## Deploying to production

This is a standard Next.js app. The transcription route works on any Node host.
The **export route needs FFmpeg on the server**, so:

- **Vercel:** the transcription route deploys as-is. The FFmpeg export route
  needs an environment where the `ffmpeg` binary is available (e.g. a container
  / a separate worker / a host that bundles FFmpeg) — serverless functions don't
  ship FFmpeg by default.
- **Docker / VPS / Render / Fly.io:** install FFmpeg in the image
  (`apt install -y ffmpeg`), set `OPENAI_API_KEY`, then `npm run build` and
  `npm start`.

Set `OPENAI_API_KEY` in your host's environment variables (not committed).

---

## Tests

```bash
npm test
```

Covers the core editor/subtitle logic in `lib/subtitles.ts`: caps
transformation, SRT/VTT parsing and serialization, the preset+override merge
(`styleFor`), auto-generate preset application, split/merge, clamping, and that
the built-in default matches the spec.
