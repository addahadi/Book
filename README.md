# Folio

**A reading-first PDF experience for the web.** Not an editor, not a PDF toolkit — a paginated
reader built around **annotation** and **sense of place**, meant to make digital reading feel
closer to a physical book.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)
[![Built with React + Vite](https://img.shields.io/badge/React%20%2B%20Vite%20%2B%20TypeScript-informational)](#tech-stack)
[![Local & private](https://img.shields.io/badge/data-100%25%20on--device-success)](#privacy)

> **Live demo:** _add your Vercel URL here once deployed_

<!-- Add a screenshot or GIF here — it does more than any paragraph.
     Drop images in docs/ and reference them, e.g.:
     ![Folio](docs/screenshot-reader.png) -->

---

## Why

Physical books beat digital ones for *thinking*, not for *looking*. Folio doesn't fake
paper — it closes the specific deficits that make PDF reading worse than paper for a serious
reader, in priority order:

1. **Annotation / marginalia** — mark up dense text and find those marks again. *The core.*
2. **Sense of place** — know *where* you are and where a passage was. *The wedge.*
3. **Focus** — a book has no tabs, notifications, or upsells.
4. **Eye comfort** — pagination and a warm night mode instead of an endless scroll.

See [`SPEC.md`](./SPEC.md) for the full product rationale, the ranked deficits, and the
deliberate non-goals.

## Features

**Reading surface**
- **Pages turn, they never scroll** — the identity of the product. ← / → keys, edge clicks/taps,
  on-screen buttons, and swipe on touch.
- **Line-aware banding** — tall pages are read in bands that break on line boundaries, never
  bisecting a line, with one line repeated across the turn as a continuity handhold.
- **Two-hands position indicator** with grab-to-seek and live thumbnails — a *felt* sense of place,
  not a scrollbar.
- **Warm night mode** for eye comfort, and a **focus mode** where the chrome fades away as you read.
- **Auto-resume** — every book reopens exactly where you left off.
- **Mobile-aware** — responsive toolbars, margin cropping to enlarge text, pinch-to-zoom escape hatch.

**Annotation**
- **Highlights, underlines, and strike-through** over selectable text.
- **Margin notes** anchored to the text, plus **bookmarks / dog-ears**.
- A **notebook panel** collecting every mark in a book, with detail pages per annotation.
- **Export / import** all annotations as a file — your safety valve against cleared browser storage.

**Navigation & library**
- **Local bookshelf** in IndexedDB — drag-and-drop a PDF, opens instantly, fully offline.
- **Embedded table of contents** (with a bookmark-derived fallback) and **full-text search**.
- Scanned / image-only PDFs degrade gracefully with a region-based annotation fallback.

## Privacy

**Nothing leaves your device.** Book bytes and annotations live entirely in your browser's
IndexedDB. There is no backend, no account, and no telemetry in v1 — and because this repo is
open source, that claim is auditable rather than a promise.

## Tech stack

- **React + TypeScript + Vite**
- **[pdfjs-dist](https://github.com/mozilla/pdf.js)** used directly (not react-pdf) for full
  control over pagination and the custom text / annotation layers
- **Zustand** for reader state
- **Dexie.js** (IndexedDB) for book bytes + an annotation sidecar — the PDF is never rewritten
- **Tailwind CSS** for styling

## Getting started

```bash
npm install
npm run dev        # Vite dev server
npm run build      # tsc -b (project references) then vite build
npm run typecheck  # type-check only — the current CI gate
npm run preview    # serve the production build locally
```

Requires Node 18+.

## Project layout

```
src/
  types.ts             Domain model (Book, Annotation) — SPEC §8
  App.tsx              Landing → Shelf → Reader switch
  Landing.tsx          First-visit explainer / pitch
  db/                  Dexie schema, library + annotation persistence
  store/               Zustand stores (reader, library, theme)
  library/Shelf.tsx    The local bookshelf (drag-and-drop ingest)
  reader/              The reader: pagination, text layer, marks, notebook,
                       search, TOC, thumbnails, banding — pdf.js lives in pdf.ts
```

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for how to get set up, the
project's guardrails, and how to open an issue or pull request. Please also read our
[Code of Conduct](./CODE_OF_CONDUCT.md).

The **non-goals in `SPEC.md` §3 are load-bearing** — features are chosen by subtraction, so please
open an issue to discuss scope before building something new.

## License

Licensed under the **GNU Affero General Public License v3.0** — see [`LICENSE`](./LICENSE).

The AGPL keeps Folio open: anyone may use, study, modify, and share it, and anyone who
runs a modified version as a network service must publish their changes under the same license.

## Acknowledgements

Built on Mozilla's [pdf.js](https://github.com/mozilla/pdf.js). The open-source, privacy-first
approach is inspired by projects like [Readest](https://github.com/readest/readest).
