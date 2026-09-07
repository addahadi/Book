import { useEffect, useRef, useState } from 'react';
import type { PdfDocument } from './pdf';

// Thumbnail rendering for the seek scrubber (issue #21). This never imports
// pdfjs-dist — it drives the typed page proxies exposed by pdf.ts, so pdf.js
// stays contained there (SPEC §7).

const THUMB_WIDTH = 180; // CSS px backing size — small enough to render in tens of ms
const DEBOUNCE_MS = 80; // let the cursor settle before rendering the page under it
const LRU_MAX = 40; // recent pages kept in memory; older entries are dropped

// Render one page to an offscreen canvas and return a PNG data URL. Cancelable:
// a superseded render (the cursor has moved on) is abandoned rather than left to
// clog pdf.js's single worker behind a stale request.
function renderThumbnail(doc: PdfDocument, page: number, cssWidth: number) {
  let cancelled = false;
  let task: { cancel: () => void } | null = null;
  const promise = (async () => {
    const pdfPage = await doc.getPage(page);
    if (cancelled) throw new DOMException('superseded', 'AbortError');
    const base = pdfPage.getViewport({ scale: 1 });
    const scale = cssWidth / base.width;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = pdfPage.getViewport({ scale: scale * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('no 2d context');
    const t = pdfPage.render({ canvasContext: ctx, viewport });
    task = t;
    await t.promise;
    if (cancelled) throw new DOMException('superseded', 'AbortError');
    return canvas.toDataURL('image/png');
  })();
  return { promise, cancel: () => ((cancelled = true), task?.cancel()) };
}

// Return the thumbnail data URL for `page`, rendering it on demand — debounced
// while the cursor moves, superseded renders cancelled, recent pages cached in
// memory (LRU). Returns undefined until the page's thumbnail is ready; the caller
// shows the page number + % meanwhile so the preview is never blank. No
// IndexedDB persistence (issue #21): thumbnails regenerate cheaply.
export function useThumbnail(doc: PdfDocument | null, page: number | null): string | undefined {
  const cacheRef = useRef(new Map<number, string>());
  const docRef = useRef(doc);
  const activeRef = useRef<{ page: number; cancel: () => void } | null>(null);
  const [, bump] = useState(0);

  // Drop the cache when the document changes (a different book was opened).
  if (docRef.current !== doc) {
    docRef.current = doc;
    cacheRef.current = new Map();
    activeRef.current?.cancel();
    activeRef.current = null;
  }

  useEffect(() => {
    if (!doc || page == null || cacheRef.current.has(page)) return;
    const timer = window.setTimeout(() => {
      // Cancel a render for a page the cursor has since left.
      if (activeRef.current && activeRef.current.page !== page) {
        activeRef.current.cancel();
        activeRef.current = null;
      }
      if (cacheRef.current.has(page)) return;
      const { promise, cancel } = renderThumbnail(doc, page, THUMB_WIDTH);
      activeRef.current = { page, cancel };
      promise
        .then((url) => {
          const cache = cacheRef.current;
          cache.set(page, url);
          if (cache.size > LRU_MAX) {
            const oldest = cache.keys().next().value; // Map keeps insertion order
            if (oldest !== undefined) cache.delete(oldest);
          }
          if (activeRef.current?.page === page) activeRef.current = null;
          bump((n) => n + 1); // re-render so the ready thumbnail shows
        })
        .catch(() => {
          /* superseded or render race — ignore. */
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [doc, page]);

  // Cancel any in-flight render on unmount.
  useEffect(() => () => activeRef.current?.cancel(), []);

  return page != null ? cacheRef.current.get(page) : undefined;
}
