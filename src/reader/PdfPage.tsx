import { useEffect, useMemo, useRef, useState } from 'react';
import { TextLayer, type PdfDocument, type TextLayerInstance } from './pdf';
import type { Annotation, RegionRect, TextAnchor } from '../types';
import { anchorToRange, buildTextIndex, rangeToAnchor, type PageTextIndex } from './anchor';
import { coalesceLineRects, markRectStyle, type MarkRect } from './marks';
import { ensureTextLayerRegistered, unregisterTextLayer } from './textSelection';
import type { PageCache } from './prefetch';

// A drag shorter than this (px, either axis) counts as a click, not a region
// box — so a plain tap on a scanned page can select an existing box to remove
// rather than dropping a zero-area rectangle.
const REGION_MIN_DRAG = 6;

// A user selection resolved to an anchor plus its on-screen rect (for the menu).
export type Selection = { anchor: TextAnchor; rect: DOMRect };

// A visual line's vertical extent on the rendered page, in CSS px from the page
// top. The parent packs line-aware bands from these (issue #20).
export type LineBox = { top: number; bottom: number };

// Cluster the text layer's per-item spans into visual line boxes. pdf.js gives a
// span per text *item*, several per line; spans on one line share a vertical
// band, so we union every span that vertically overlaps the current line into
// one box. Empty and zero-height spans (markedContent wrappers, EOL markers) are
// skipped. Positions come from offsetTop/offsetHeight — the untransformed layout
// box — which is exactly the vertical geometry we band on (pdf.js only ever
// transforms spans horizontally, via scaleX, to fit width).
function measureLines(divs: HTMLElement[]): LineBox[] {
  const boxes: LineBox[] = [];
  for (const d of divs) {
    const h = d.offsetHeight;
    if (h <= 0 || !d.textContent || !d.textContent.trim()) continue;
    boxes.push({ top: d.offsetTop, bottom: d.offsetTop + h });
  }
  boxes.sort((a, b) => a.top - b.top);
  const lines: LineBox[] = [];
  for (const b of boxes) {
    const line = lines[lines.length - 1];
    // Same visual line when this box vertically overlaps the current line band.
    if (line && b.top < line.bottom - 1) {
      line.top = Math.min(line.top, b.top);
      line.bottom = Math.max(line.bottom, b.bottom);
    } else {
      lines.push({ ...b });
    }
  }
  return lines;
}

type Props = {
  /** Loaded document to render from, or null while it loads. */
  doc: PdfDocument | null;
  /** 1-based page number to render. */
  page: number;
  /** CSS width (px) to render the page at — the page is fit to this width. */
  width: number;
  /** Shared page-raster cache (issue #22): the visible canvas is blitted from a
      (usually prefetched) offscreen render, so a page turn never flashes blank. */
  cache: PageCache;
  /** Marks anchored to this page, re-rendered over the text (issue #09). */
  annotations: Annotation[];
  /** Scanned-PDF fallback (issue #12): no text layer, so text selection is off
      and dragging on the page draws a region-box highlight instead. */
  regionMode?: boolean;
  /** Reports the page's rendered CSS height and its visual line boxes (CSS px
      from the page top) once drawn, so the parent can pack line-aware bands
      (issue #20). `lines` is empty for a scanned page (no text layer). */
  onMeasure?: (pageHeight: number, lines: LineBox[]) => void;
  /** Fired on pointer-up: a resolved selection to mark up, or null to dismiss. */
  onSelect?: (selection: Selection | null) => void;
  /** Fired when an existing mark is clicked, with its on-screen rect. */
  onMarkClick?: (id: string, rect: DOMRect) => void;
  /** Fired when a margin note flag is clicked, with the flag's on-screen rect. */
  onNoteClick?: (id: string, rect: DOMRect) => void;
  /** Fired when a region box is drawn (region mode), as a normalized 0..1 rect. */
  onRegionDraw?: (rect: RegionRect) => void;
};

type RenderedMark = {
  id: string;
  type: Annotation['type'];
  color?: string;
  note?: string;
  rects: MarkRect[];
};

// Whether a mark carries a margin note worth flagging — a standalone note, or a
// highlight/underline/strike with note text attached (issue #10).
function hasNote(m: RenderedMark): boolean {
  return m.type === 'note' || !!(m.note && m.note.length > 0);
}

// Renders a whole PDF page to a canvas at a given CSS width (fit-width), with a
// pdf.js text layer aligned over it for selection, and a mark layer over that
// painting persisted highlights / underlines / strikes. The canvas backing
// store is drawn at device resolution for crisp text; the text and mark layers
// are laid out in CSS pixels so they sit exactly over the painted glyphs. The
// parent clips this to the viewport and slides it up to reveal one band.
export default function PdfPage({
  doc,
  page,
  width,
  cache,
  annotations,
  regionMode = false,
  onMeasure,
  onSelect,
  onMarkClick,
  onNoteClick,
  onRegionDraw,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  // The offset index for the currently rendered layer. In state (not a ref) so
  // the mark layer re-derives its rects once the text layer is ready.
  const [index, setIndex] = useState<PageTextIndex | null>(null);
  const [marks, setMarks] = useState<RenderedMark[]>([]);
  // The page's rendered CSS size, so region boxes (stored normalized) can be
  // mapped to pixels and a fresh drag normalized back.
  const [size, setSize] = useState({ w: 0, h: 0 });
  // The region box being dragged out right now (px, wrapper-relative), and the
  // in-flight gesture's origin + whether it has moved far enough to be a draw.
  const [draft, setDraft] = useState<MarkRect | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (!doc || width <= 0) return;
    let cancelled = false;
    let textLayer: TextLayerInstance | null = null;
    setIndex(null);

    (async () => {
      // Rasterize (or reuse) the page offscreen via the shared cache (#22), then
      // blit it into the visible canvas. The blit is synchronous — we set the
      // canvas size and drawImage in the same tick — so the visible canvas never
      // paints a blank frame mid-turn: it shows the old page until the new raster
      // is ready, then swaps instantly (immediately, when the page was
      // prefetched). The backing store carries the oversampled detail; CSS size
      // is the fitted size, so the page is never upscaled.
      const rendered = await cache.render(page, width);
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;
      const { canvas: src, heightCss } = rendered;
      canvas.width = src.width;
      canvas.height = src.height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${heightCss}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(src, 0, 0);
      setSize({ w: width, h: heightCss });

      // Scanned page (no text layer): skip the selectable text layer entirely —
      // there are no glyph runs to anchor to. The region layer handles marking,
      // and with no line boxes the parent falls back to geometric bands.
      if (regionMode) {
        onMeasure?.(heightCss, []);
        setIndex(null);
        return;
      }

      // pdf.js caches getPage, so this is effectively free after the raster.
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const scale = width / pdfPage.getViewport({ scale: 1 }).width;

      // Text layer, laid out in CSS pixels over the canvas (CSS-scale viewport,
      // NOT the dpr-scaled one). Render into a DETACHED element and swap it into
      // the live layer only once complete: TextLayer.render() appends spans
      // incrementally and ignores our cancelled flag, so a stale/aborted render
      // must never touch the on-screen container or its spans double up (the
      // "selection looks doubled" bug). `--scale-factor` drives the span
      // positions/sizes, so it lives on the host the spans end up in.
      const host = textRef.current;
      if (!host) return;
      const detached = document.createElement('div');
      const textContent = await pdfPage.getTextContent();
      if (cancelled) return;
      textLayer = new TextLayer({
        textContentSource: textContent,
        container: detached,
        viewport: pdfPage.getViewport({ scale }),
      });
      await textLayer.render();
      if (cancelled) {
        textLayer.cancel();
        return;
      }
      host.style.setProperty('--scale-factor', String(scale));
      host.replaceChildren(...Array.from(detached.childNodes));
      // Re-attach the selection sentinel after swapping in the fresh spans, so
      // dragging a selection stays smooth (see ./textSelection). Idempotent.
      ensureTextLayerRegistered(host);
      // Measure line boxes now that the spans are live in the DOM, and report
      // them with the height so the parent can pack line-aware bands (#20).
      onMeasure?.(heightCss, measureLines(textLayer.textDivs));
      setIndex(buildTextIndex(textLayer.textDivs, textLayer.textContentItemsStr));
    })().catch(() => {
      /* render races are expected during fast turns; ignore. */
    });

    return () => {
      cancelled = true;
      textLayer?.cancel();
    };
  }, [doc, page, width, cache, onMeasure, regionMode]);

  // Detach this page's text layer from the global selection-smoothing registry
  // on unmount (the render effect re-registers on every re-render).
  useEffect(() => () => unregisterTextLayer(textRef.current), []);

  // Re-derive the mark rects whenever the layout (index) or the marks change.
  // Each anchor resolves to a Range against the fresh text layer, whose client
  // rects — one per wrapped line — are converted to wrapper-relative boxes.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !index) {
      setMarks([]);
      return;
    }
    const origin = wrap.getBoundingClientRect();
    const out: RenderedMark[] = [];
    for (const a of annotations) {
      if (a.anchor?.kind !== 'text') continue; // bookmarks/region marks aren't text runs
      const range = anchorToRange(index, a.anchor);
      if (!range) continue;
      // Raw client rects come back one-per-text-item and double up on styled
      // lines; coalesce them to one box per line so the wash never self-stacks
      // (see coalesceLineRects). The width/height filter also drops the browser's
      // zero-area left-edge boundary rects before they'd paint.
      const rects = coalesceLineRects(
        [...range.getClientRects()]
          .filter((r) => r.width > 0 && r.height > 0)
          .map((r) => ({
            left: r.left - origin.left,
            top: r.top - origin.top,
            width: r.width,
            height: r.height,
          })),
      );
      if (rects.length)
        out.push({ id: a.id, type: a.type, color: a.color, note: a.note, rects });
    }
    setMarks(out);
  }, [index, annotations]);

  // Handle pointer-up on the (top, transparent) text layer. A drag ends here
  // with a live selection → report it for the mark menu. A plain click with no
  // selection → hit-test the point against the marks painted underneath and, if
  // it lands on one, open its remove menu; otherwise dismiss.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const onUp = (e: PointerEvent) => {
      const sel = window.getSelection();
      const collapsed = !sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.toString();
      if (collapsed) {
        const hit = hitTestMark(e.clientX, e.clientY);
        if (hit) onMarkClick?.(hit.id, hit.rect);
        else onSelect?.(null);
        return;
      }
      if (!index) return;
      const range = sel!.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) {
        onSelect?.(null);
        return;
      }
      const anchor = rangeToAnchor(index, range);
      onSelect?.(anchor ? { anchor, rect: range.getBoundingClientRect() } : null);
    };
    el.addEventListener('pointerup', onUp);
    return () => el.removeEventListener('pointerup', onUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, marks, onSelect, onMarkClick]);

  // Which mark (if any) covers a client point, with its bounding rect in client
  // coords for placing the remove menu.
  function hitTestMark(clientX: number, clientY: number): { id: string; rect: DOMRect } | null {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const origin = wrap.getBoundingClientRect();
    const px = clientX - origin.left;
    const py = clientY - origin.top;
    for (const m of marks) {
      const hit = m.rects.some(
        (r) => px >= r.left && px <= r.left + r.width && py >= r.top && py <= r.top + r.height,
      );
      if (!hit) continue;
      const left = Math.min(...m.rects.map((r) => r.left));
      const top = Math.min(...m.rects.map((r) => r.top));
      const right = Math.max(...m.rects.map((r) => r.left + r.width));
      const bottom = Math.max(...m.rects.map((r) => r.top + r.height));
      return {
        id: m.id,
        rect: new DOMRect(left + origin.left, top + origin.top, right - left, bottom - top),
      };
    }
    return null;
  }

  // A page-level bookmark (issue #11), if this page carries one — drawn as a
  // colour-coded dog-ear folded into the page's top-right corner.
  const bookmark = annotations.find((a) => a.type === 'bookmark');

  // Region-box highlights on this page (issue #12), each stored normalized 0..1
  // over the page box and projected back to CSS pixels for painting and hit-tests.
  const regionBoxes = useMemo(() => {
    if (!size.w || !size.h) return [];
    const out: { id: string; color?: string; rect: MarkRect }[] = [];
    for (const a of annotations) {
      if (a.anchor?.kind !== 'region') continue;
      out.push({
        id: a.id,
        color: a.color,
        rect: {
          left: a.anchor.x * size.w,
          top: a.anchor.y * size.h,
          width: a.anchor.w * size.w,
          height: a.anchor.h * size.h,
        },
      });
    }
    return out;
  }, [annotations, size]);

  // Pointer point relative to the page wrapper's top-left.
  function wrapPoint(clientX: number, clientY: number) {
    const o = wrapRef.current?.getBoundingClientRect();
    return { x: clientX - (o?.left ?? 0), y: clientY - (o?.top ?? 0) };
  }

  const onRegionPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = wrapPoint(e.clientX, e.clientY);
    dragRef.current = { x: p.x, y: p.y, moved: false };
    setDraft(null);
  };

  const onRegionPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = wrapPoint(e.clientX, e.clientY);
    if (Math.abs(p.x - d.x) > REGION_MIN_DRAG || Math.abs(p.y - d.y) > REGION_MIN_DRAG)
      d.moved = true;
    setDraft({
      left: Math.min(p.x, d.x),
      top: Math.min(p.y, d.y),
      width: Math.abs(p.x - d.x),
      height: Math.abs(p.y - d.y),
    });
  };

  const onRegionPointerUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    const d = dragRef.current;
    const box = draft;
    dragRef.current = null;
    setDraft(null);
    if (!d) return;

    // A tap (no real drag) selects the region under the point for removal, or
    // dismisses any open menu when it lands on bare page.
    if (!d.moved || !box || box.width < REGION_MIN_DRAG || box.height < REGION_MIN_DRAG) {
      const hit = regionBoxes.find(
        (b) =>
          d.x >= b.rect.left &&
          d.x <= b.rect.left + b.rect.width &&
          d.y >= b.rect.top &&
          d.y <= b.rect.top + b.rect.height,
      );
      const o = wrapRef.current?.getBoundingClientRect();
      if (hit && o)
        onMarkClick?.(
          hit.id,
          new DOMRect(o.left + hit.rect.left, o.top + hit.rect.top, hit.rect.width, hit.rect.height),
        );
      else onSelect?.(null);
      return;
    }

    // A real drag → a new region box, stored normalized to the page box.
    const W = size.w || 1;
    const H = size.h || 1;
    onRegionDraw?.({
      kind: 'region',
      x: box.left / W,
      y: box.top / H,
      w: box.width / W,
      h: box.height / H,
    });
  };

  return (
    <div ref={wrapRef} className="relative">
      <canvas
        ref={canvasRef}
        className="pdf-page block rounded shadow-lg ring-1 ring-black/10 dark:ring-white/10"
      />
      {bookmark && (
        <div
          className="dogEar"
          aria-hidden
          title={bookmark.label ? `Bookmark: ${bookmark.label}` : 'Bookmarked'}
          style={{ borderTopColor: bookmark.color ?? '#facc15' }}
        />
      )}
      {/* Persisted marks, painted UNDER the text layer (click-through) so they
          never block selection; removal is a tap hit-test on the text layer. */}
      <div className="markLayer" aria-hidden>
        {marks.map((m) =>
          m.rects.map((r, i) => (
            <div key={`${m.id}:${i}`} style={markRectStyle(m.type, m.color, r)} />
          )),
        )}
      </div>
      {/* Persisted region-box highlights (issue #12), painted under the drawing
          surface so a scanned page reads like a marked-up page. */}
      {regionMode && (
        <div className="regionLayer" aria-hidden>
          {regionBoxes.map((b) => (
            <div
              key={b.id}
              className="regionBox"
              style={{
                left: b.rect.left,
                top: b.rect.top,
                width: b.rect.width,
                height: b.rect.height,
                background: b.color,
              }}
            />
          ))}
          {draft && (
            <div
              className="regionDraft"
              style={{
                left: draft.left,
                top: draft.top,
                width: draft.width,
                height: draft.height,
              }}
            />
          )}
        </div>
      )}
      {/* Transparent, selectable glyph boxes aligned over the canvas (on top). On
          a scanned page (region mode) this same surface captures the drag that
          draws a region box instead of a text selection. */}
      <div
        ref={textRef}
        className="textLayer"
        onPointerDown={regionMode ? onRegionPointerDown : undefined}
        onPointerMove={regionMode ? onRegionPointerMove : undefined}
        onPointerUp={regionMode ? onRegionPointerUp : undefined}
        // Keep a region drag on a touch device from bubbling to the surface's
        // swipe handler (which would turn the page mid-draw).
        onTouchStart={regionMode ? (e) => e.stopPropagation() : undefined}
        onTouchEnd={regionMode ? (e) => e.stopPropagation() : undefined}
        style={regionMode ? { cursor: 'crosshair', userSelect: 'none', touchAction: 'none' } : undefined}
      />
      {/* Margin note flags (issue #10), above the text layer so they're clickable.
          The container is click-through; only the flags catch pointer events, and
          they sit in the page's right margin so they don't block selection. */}
      <div className="noteLayer" aria-hidden>
        {marks.filter(hasNote).map((m) => {
          const top = Math.min(...m.rects.map((r) => r.top));
          return (
            <button
              key={`note:${m.id}`}
              type="button"
              aria-label="Open note"
              title="Open note"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onNoteClick?.(m.id, (e.currentTarget as HTMLElement).getBoundingClientRect());
              }}
              className="noteFlag"
              style={{ top }}
            >
              ✎
            </button>
          );
        })}
      </div>
    </div>
  );
}
