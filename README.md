# Reading Stage

A reading-first PDF experience for the web. Not an editor, not a competitor — a serious,
shippable reader that makes digital reading feel closer to a physical book, built around
**annotation** and **sense of place**.

See [`SPEC.md`](./SPEC.md) for the full product & build spec.

## Stack

- **React + TypeScript + Vite**
- **pdfjs-dist** (direct) for pagination + custom annotation/text layers
- **Zustand** for reader state
- **Dexie.js** (IndexedDB) for book bytes + annotation sidecar
- **Tailwind** for styling

## Status

**M0 — Walking skeleton.** Vite/React/TS/Tailwind up; pdfjs-dist renders a page of a
bundled PDF to canvas. Everything else is tracked as issues (see `.scratch/reading-stage/issues/`).

## Develop

```bash
npm install
npm run dev        # start the dev server
npm run build      # type-check + production build
npm run typecheck  # type-check only
```

## Project layout

```
src/
  types.ts            Domain model (Book, Annotation) — SPEC §8
  db/db.ts            Dexie schema (books + annotations sidecar)
  store/reader.ts     Zustand reader state
  reader/
    pdf.ts            pdf.js worker setup + document loading
    PdfCanvas.tsx     Renders the current page to canvas
  assets/sample.pdf   Bundled demo PDF for the skeleton
```

## Principles

- **Pagination is the identity.** Discrete pages, not scroll.
- **Focus by subtraction.** The most powerful focus feature is what we refuse to build.
- **Local & private.** Books never leave the device in v1.
