# Reading Stage — Product & Build Spec

> A reading-first PDF experience for the web. Not an editor, not a competitor —
> a serious, shippable reader that makes digital reading feel closer to a physical book,
> built around **annotation** and **sense of place**.

**Status:** v1 design locked · **Owner:** Youcef · **Stack:** React + TS + Vite + pdfjs-dist
**Last updated:** 2026-08-17

---

## 1. Thesis

Physical books beat digital ones for *thinking*, not for *looking*. We are not going to
fake paper. We are going to close the specific, concrete deficits that make PDF reading worse
than paper for a serious reader — in priority order.

## 2. The four deficits (ranked)

1. **Annotation / marginalia** — marking up dense text and finding those marks again. *The core.*
2. **Spatial memory / sense of place** — knowing *where* you are and where a passage was. *The wedge.*
3. **Focus / distraction** — a book has no tabs, notifications, or upsells.
4. **Eye comfort** — screens tire eyes; pagination + warm night mode help.

## 3. Non-goals (deliberate, write them down)

- **Not an editor.** No PDF form-filling, page manipulation, signing, exporting edited PDFs.
- **Not competing for market share.** Goal is real users who love it, not beating MarginNote/Readwise.
- **No tactile realism.** No page-curl animation, no fake paper grain. Skeuomorphism only where it carries *information* (the two-hands indicator).
- **No OCR in v1.** Target born-digital, selectable-text PDFs. Scanned books degrade gracefully.
- **No gamification in v1.** No streaks, timers, or reading stats. *Deferred, not rejected* — revisit later as its own feature.
- **No backend / accounts in v1.** Fully local. Backend comes after the reading experience is proven.
- **No knowledge-graph in v1.** Notes are first-class objects, but no note-to-note linking or tags yet.

## 4. Target users

Serious readers of dense, re-read-heavy material (philosophy, psychology, technical books) who
read born-digital PDFs and want to annotate and navigate like they would a physical book.
v1 is validated by the author dogfooding it as a daily reader.

## 5. Product principles

- **Pagination is the identity.** Discrete pages, not scroll. Scroll destroys sense of place.
- **Focus by subtraction.** The most powerful focus feature is what we refuse to build.
- **Local & private.** Books never leave the device in v1.
- **Ship the smallest daily-usable thing, then let real use drive priorities.**

---

## 6. Feature specification

### 6.1 Reading surface
- **Paginated by default.** Pages *turn* (replace the view); they do not scroll.
- **Layouts:** single page fit to the screen's **width** so text stays readable. A page taller than
  the screen is read in **bands** — each turn slides the view down one screen-height (with a slight
  overlap so the line at the seam isn't lost), and the last band clamps flush to the page bottom.
  This keeps text legible on tall pages while staying inside "pages turn, never scroll." *(Supersedes
  the original two-page-spread-on-wide default; the open-book spread returns later as an optional
  "Zoom" reading mode — see issue #06b.)*
- **Turn controls:** ← / → keys, click/tap page edges, on-screen buttons, swipe on touch.
- **Scroll mode:** available as a hidden toggle only (cheap via PDF.js), never the default, never in the pitch.
- **Sense of place:** a "two-hands" indicator — left block = pages behind you, right block = pages ahead —
  plus "page N of M · P% in". Not a scroll bar; a *felt* position.
- **Night mode:** real warm dark theme for eye comfort. Not fake paper.
- **Auto-resume:** each book reopens exactly where you left off (page + position).

### 6.2 Library & persistence
- **Full bookshelf in IndexedDB.** The PDF's bytes are stored locally; the shelf is always there, opens
  instantly, works fully offline, in every browser.
- **Identity:** each book keyed by a **content hash**, so annotations always re-bind to the right book.
- **Ingest:** drag-and-drop a PDF (and file picker) → added to shelf.
- **Management:** "remove from library" control to reclaim storage.
- **Safety valve:** export/import all annotations as a file (guards against cleared browser storage).

### 6.3 Annotation (the core)
Applies to born-digital, selectable-text PDFs. Stored as a **sidecar** in IndexedDB — the PDF file is
**never** rewritten.

- **Highlight** — colour a selected text run; multiple colours = multiple meanings.
- **Underline / strikethrough** — same engine, different look; emphasise or reject text.
- **Margin note** — a written note attached to a highlight or spot; shown in margin / pop-up. Expandable.
- **Bookmark / dog-ear** — mark a whole page to jump back to; named + colour-coded.
- **Scanned-PDF fallback:** when no text layer exists, allow **bookmarks** and **region-box highlights**
  (rectangle over the image) only, with a clear "this book has no text layer" notice.

### 6.4 Annotations as first-class objects
- Every highlight/note has a **stable ID** and its own **detail page**: excerpt + expandable note +
  metadata (book, page, date, colour) + "go to source" link.
- **Data model leaves room** for `tags: []` and `links: []` — but v1 builds neither.

### 6.5 Notebook panel
- Per-book side panel listing **every** highlight, note, and bookmark in **reading order**.
- **Click-to-jump** to the exact page. **Filter by colour.**
- Scoped to one book at a time in v1. (Cross-library search + Markdown export deferred.)

### 6.6 Navigation
- **Table of contents** from the PDF's embedded outline (clickable sidebar).
- **Full-text search** across the book, with page + snippet, click-to-jump.
- **Go-to-page.**
- **No-TOC fallback:** when a book has no embedded outline, the user's **bookmarks become the TOC** —
  a hand-made chapter list built as they read.

### 6.7 Focus
- **Minimal by default:** chrome (toolbars/panels) auto-fades after seconds of no interaction; nudge to restore.
- **Focus Mode:** one gesture → fullscreen, panels collapsed, page centred, margins dimmed; `Esc` exits.
- **Rejected for v1:** timers, streaks, reading stats (deferred with gamification).

---

## 7. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **React + TypeScript** | Author's strength; biggest ecosystem. |
| Build | **Vite** | Fast dev server. |
| PDF rendering | **pdfjs-dist (direct)** | Full control of pagination + custom annotation/text layers. *Not* react-pdf. |
| State | **Zustand** | Light, fits reader state; no Redux ceremony. |
| Storage | **Dexie.js** | Typed, ergonomic IndexedDB for book bytes + annotation sidecar. |
| Styling | **Tailwind** | Author's preference. |

---

## 8. Data model (sketch)

```ts
type Book = {
  id: string;            // content hash of the PDF bytes
  title: string;
  bytes: Blob;           // stored in IndexedDB
  addedAt: number;
  lastPage: number;      // for auto-resume
  lastPosition?: number;
  hasTextLayer: boolean;
};

type Annotation = {
  id: string;            // stable, unique
  bookId: string;
  type: 'highlight' | 'underline' | 'strike' | 'note' | 'bookmark' | 'region';
  page: number;
  anchor: TextAnchor | RegionRect;  // text range (born-digital) or box (scanned)
  color?: string;
  note?: string;         // margin note / reflection body
  label?: string;        // for bookmarks
  createdAt: number;
  tags: string[];        // reserved — empty in v1
  links: string[];       // reserved — empty in v1
};
```

---

## 9. Build roadmap

Each milestone is independently usable. Build M0→M4 heads-down, hit the dogfood line, then let
real reading drive M5–M7.

| # | Milestone | Done when you can… |
|---|---|---|
| **M0** | Walking skeleton | Vite/React/TS/Tailwind up; pdfjs-dist renders one page of one PDF to canvas. |
| **M1** | Reading core | Paginate (single + spread), turn pages, go-to-page, auto-resume, night mode. |
| **M2** | Your library | Drag a PDF in → stored in IndexedDB, content-hash id, shelf UI, remove. |
| **M3** | Highlights | Text layer + multi-colour highlight + underline/strike, sidecar-persisted. |
| **M4** | Marginalia | Margin notes on highlights + bookmarks/dog-ears. |
| ⭐ | **DOGFOOD LINE** | *Read your whole library and mark it up. Start using it for real.* |
| **M5** | Notebook + note objects | Notebook panel, annotation detail pages, colour filter. |
| **M6** | Navigation | Embedded TOC, full-text search, bookmark-as-TOC fallback. |
| **M7** | Immersion + safety | Focus Mode, auto-fading chrome, export/import annotations. |

## 10. Deferred (post-v1, in rough order of interest)

- OCR for scanned books (unlocks highlight/search on image-only PDFs).
- Freehand ink annotation.
- Tags on notes → then note-to-note linking (Zettelkasten).
- Markdown / Obsidian export of notes; cross-library note search.
- Backend + accounts + cross-device sync.
- Gamification (done thoughtfully, without turning reading into a metrics game).
- Native tablet app (where the reading experience truly shines).

## 11. Open questions to resolve before/at M0

- EPUB support, or PDF-only for the foreseeable future? (Currently: PDF-only.)
- Storage quota strategy when a library grows large (warn at threshold? evict least-used?).
- Exact highlight-anchoring approach across PDF.js text-layer coordinate quirks (spike in M3).
