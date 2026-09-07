import { useMemo } from 'react';
import type { PdfDocument } from './pdf';

// Page-raster prefetch for instant, flash-free page turns (issue #22). A page is
// rasterized to an offscreen canvas that PdfPage blits into its visible canvas;
// because the blit is synchronous, the visible canvas never goes blank mid-turn,
// and when a neighbour was prefetched the swap is immediate. Renders never import
// pdfjs-dist — they drive the typed page proxies from pdf.ts (SPEC §7).

// Oversample factor + canvas-area ceiling, mirrored from PdfPage's original
// raster so a prefetched page is pixel-identical to a direct render.
const MIN_RENDER_SCALE = 2;
const MAX_CANVAS_AREA = 16_777_216;
// Above this backing-store area, a *speculative* prefetch renders "parse-only"
// (warm pdf.js's page + text-content caches) rather than hold a big offscreen
// canvas — the memory-pressure fallback. The visible turn still full-renders,
// just from warm caches.
const PARSE_ONLY_AREA = 4_000_000;
// Rendered pages kept in memory: current + neighbours + a little history.
const CACHE_MAX = 6;

export type RenderedPage = { canvas: HTMLCanvasElement; heightCss: number; width: number };

export type PageCache = {
  // Render for display: from cache if warm, otherwise a fresh full raster.
  render: (page: number, width: number) => Promise<RenderedPage>;
  // Speculatively warm a neighbour — best-effort, skipped while scrubbing, and
  // parse-only for very tall pages. Never returns anything.
  prefetch: (page: number, width: number) => void;
};

// A scrub (issue #21) shares pdf.js's single worker with prefetch. While the user
// is seeking, pause speculative prefetch and cancel any in-flight one so the
// thumbnail preview never stalls behind a big neighbour raster.
let scrubbing = false;
const activePrefetchCancels = new Set<() => void>();
export function setScrubbing(v: boolean): void {
  scrubbing = v;
  if (v) {
    activePrefetchCancels.forEach((cancel) => cancel());
    activePrefetchCancels.clear();
  }
}

// Rasterize one page to an offscreen canvas at CSS `width`. Cancelable, so a
// superseded prefetch is abandoned rather than left to clog the worker. Returns
// null for a parse-only prefetch (caches warmed, no canvas) or if cancelled.
function warm(doc: PdfDocument, page: number, width: number, allowParseOnly: boolean) {
  let cancelled = false;
  let task: { cancel: () => void } | null = null;
  const promise = (async (): Promise<RenderedPage | null> => {
    const pdfPage = await doc.getPage(page);
    if (cancelled) return null;
    const base = pdfPage.getViewport({ scale: 1 });
    const scale = width / base.width;
    const heightCss = base.height * scale;
    const dpr = window.devicePixelRatio || 1;
    const maxScale = Math.sqrt(MAX_CANVAS_AREA / Math.max(1, width * heightCss));
    const renderScale = Math.min(Math.max(dpr, MIN_RENDER_SCALE), maxScale);

    // Parse-only fallback: warm the page + text caches without holding a canvas.
    if (allowParseOnly && width * heightCss * renderScale * renderScale > PARSE_ONLY_AREA) {
      await pdfPage.getTextContent().catch(() => {});
      return null;
    }

    const viewport = pdfPage.getViewport({ scale: scale * renderScale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    // Opaque backing store: pdf.js fills the page white, so glyphs antialias
    // against solid white instead of a transparent buffer — crisper text.
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    const t = pdfPage.render({ canvasContext: ctx, viewport });
    task = t;
    await t.promise;
    if (cancelled) return null;
    pdfPage.getTextContent().catch(() => {}); // warm text cache for the turn
    return { canvas, heightCss, width };
  })();
  return { promise, cancel: () => ((cancelled = true), task?.cancel()) };
}

// A per-document page-raster cache. New per `doc` (a different book resets it).
export function usePageCache(doc: PdfDocument | null): PageCache {
  return useMemo(() => {
    const entries = new Map<string, RenderedPage>();
    const renderInflight = new Map<string, Promise<RenderedPage>>();
    const key = (page: number, width: number) => `${page}@${Math.round(width)}`;

    const store = (k: string, r: RenderedPage) => {
      entries.set(k, r);
      while (entries.size > CACHE_MAX) {
        const oldest = entries.keys().next().value; // Map keeps insertion order
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    };

    return {
      render(page, width) {
        if (!doc) return Promise.reject(new Error('no document'));
        const k = key(page, width);
        const cached = entries.get(k);
        if (cached) return Promise.resolve(cached);
        const inflight = renderInflight.get(k);
        if (inflight) return inflight;
        const p = warm(doc, page, width, false)
          .promise.then((r) => {
            renderInflight.delete(k);
            if (!r) throw new Error('no raster');
            store(k, r);
            return r;
          })
          .catch((e) => {
            renderInflight.delete(k);
            throw e;
          });
        renderInflight.set(k, p);
        return p;
      },
      prefetch(page, width) {
        if (!doc || scrubbing || page < 1 || width <= 0) return;
        const k = key(page, width);
        if (entries.has(k) || renderInflight.has(k)) return;
        const { promise, cancel } = warm(doc, page, width, true);
        activePrefetchCancels.add(cancel);
        promise
          .then((r) => {
            if (r) store(k, r);
          })
          .catch(() => {})
          .finally(() => activePrefetchCancels.delete(cancel));
      },
    };
  }, [doc]);
}
