# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Reading Stage** — a reading-first PDF experience for the web. Not an editor, not a PDF
toolkit: a paginated reader built around **annotation** and **sense of place**, meant to make
digital reading feel closer to a physical book. v1 is fully local (no backend, no accounts).

`SPEC.md` is the source of truth for product decisions — read it before making design calls.
It carries the ranked deficits the product exists to close, the explicit non-goals (§3), and
the data model (§8). When something isn't specified, the non-goals usually answer it.

## Commands

```bash
npm run dev        # Vite dev server
npm run build      # tsc -b (project references) then vite build
npm run typecheck  # tsc -b --noEmit — the only "test" gate right now
npm run preview    # serve the production build
```

There is no test runner or linter configured yet. `npm run typecheck` is the check to run
before considering work done.

## Architecture

Single-page React app. Data flows: `pdf.js` renders → Zustand holds reader state →
React components subscribe → Dexie persists to IndexedDB. Nothing leaves the device.

- **`src/reader/pdf.ts`** — the only module that touches `pdfjs-dist` directly. Sets the
  worker src (Vite bundles the ESM worker via `?url`) and exposes `loadDocument()`. Keep
  pdf.js contained here; components consume the typed wrappers, not the library.
- **`src/reader/PdfCanvas.tsx`** — renders a single page to a `<canvas>`, accounting for
  `devicePixelRatio`. Two effects: load-doc-per-`src`, and render-per-`currentPage`. Both
  guard against races with a `cancelled` flag — preserve that pattern when extending render.
- **`src/store/reader.ts`** — Zustand store for reader state. Deliberately minimal (M0):
  `currentPage` / `numPages` only. Pagination, spread mode, and night mode are added here by
  later tickets.
- **`src/db/db.ts` + `src/types.ts`** — Dexie schema and the domain model. Two tables:
  `books` (PDF bytes as a Blob, keyed by content hash) and `annotations` (a **sidecar** —
  the PDF is never rewritten). `types.ts` mirrors SPEC §8; `tags`/`links` are reserved and
  stay empty in v1. Annotations anchor either by `TextAnchor` (born-digital text offsets) or
  `RegionRect` (normalized box over the page image, for scanned PDFs).

Use `pdfjs-dist` directly — **not** react-pdf. Full control over pagination and the custom
annotation/text layers is a deliberate stack choice (SPEC §7).

## Working from tickets

v1 is planned as 19 vertical-slice tickets in `.scratch/reading-stage/issues/` (git-ignored,
scratch output). Each `NN-*.md` is a self-contained slice with **What to build**, acceptance
criteria, and a **Blocked by** line; `issues/README.md` holds the dependency graph. When the
user references "issue N", read `.scratch/reading-stage/issues/NN-*.md` for its scope and
acceptance criteria before starting — build to that ticket, not beyond it.

Current status: **M0 walking skeleton** (ticket #01) is done. The app renders one page of a
bundled sample PDF. Everything else — pagination, spread layout, library, highlights — is a
pending ticket, so the codebase is intentionally sparse; don't mistake missing features for
bugs.

**Push after every completed issue.** Once an issue is implemented and `npx tsc -b` passes,
commit that work and push it to GitHub (`origin`, branch `main`) — one commit per issue,
message referencing the ticket number (e.g. `M1: two-page spread (#03)`). Don't batch multiple
issues into one push. (The user closes the GitHub issues themselves.)

## Product guardrails (from SPEC)

- **Pagination is the identity** — pages *turn* (replace the view), they do not scroll. Scroll
  mode exists only as a hidden toggle, never the default.
- **Focus by subtraction** — the non-goals in SPEC §3 are load-bearing. No PDF editing, no OCR
  in v1, no gamification, no note-linking/tags, no backend. Don't add these speculatively.
- **Local & private** — book bytes and annotations live entirely in IndexedDB in v1.
