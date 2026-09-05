import { useEffect, useRef, useState } from 'react';
import { TextLayer, type PdfDocument, type TextLayerInstance } from './pdf';
import type { Annotation, TextAnchor } from '../types';
import { anchorToRange, buildTextIndex, rangeToAnchor, type PageTextIndex } from './anchor';
import { markRectStyle, type MarkRect } from './marks';

// A user selection resolved to an anchor plus its on-screen rect (for the menu).
export type Selection = { anchor: TextAnchor; rect: DOMRect };

type Props = {
  /** Loaded document to render from, or null while it loads. */
  doc: PdfDocument | null;
  /** 1-based page number to render. */
  page: number;
  /** CSS width (px) to render the page at — the page is fit to this width. */
  width: number;
  /** Marks anchored to this page, re-rendered over the text (issue #09). */
  annotations: Annotation[];
  /** Reports the page's rendered CSS height once drawn, so the parent can
      compute how many bands it takes and clamp the last one. */
  onHeight?: (heightCss: number) => void;
  /** Fired on pointer-up: a resolved selection to mark up, or null to dismiss. */
  onSelect?: (selection: Selection | null) => void;
  /** Fired when an existing mark is clicked, with its on-screen rect. */
  onMarkClick?: (id: string, rect: DOMRect) => void;
};

type RenderedMark = { id: string; type: Annotation['type']; color?: string; rects: MarkRect[] };

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
  annotations,
  onHeight,
  onSelect,
  onMarkClick,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  // The offset index for the currently rendered layer. In state (not a ref) so
  // the mark layer re-derives its rects once the text layer is ready.
  const [index, setIndex] = useState<PageTextIndex | null>(null);
  const [marks, setMarks] = useState<RenderedMark[]>([]);

  useEffect(() => {
    if (!doc || width <= 0) return;
    let cancelled = false;
    let textLayer: TextLayerInstance | null = null;
    setIndex(null);

    (async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Fit the page to the requested width; height follows the aspect ratio.
      const base = pdfPage.getViewport({ scale: 1 });
      const scale = width / base.width;
      const heightCss = base.height * scale;
      const dpr = window.devicePixelRatio || 1;

      // Backing store at device resolution (scale × dpr) → crisp text; CSS size
      // is the fitted size, so the page is never upscaled or stretched.
      const viewport = pdfPage.getViewport({ scale: scale * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${heightCss}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      await pdfPage.render({ canvasContext: ctx, viewport }).promise;
      if (cancelled) return;
      onHeight?.(heightCss);

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
      setIndex(buildTextIndex(textLayer.textDivs, textLayer.textContentItemsStr));
    })().catch(() => {
      /* render races are expected during fast turns; ignore. */
    });

    return () => {
      cancelled = true;
      textLayer?.cancel();
    };
  }, [doc, page, width, onHeight]);

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
      if (a.anchor.kind !== 'text') continue; // region marks are issue #12
      const range = anchorToRange(index, a.anchor);
      if (!range) continue;
      const rects = [...range.getClientRects()]
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({
          left: r.left - origin.left,
          top: r.top - origin.top,
          width: r.width,
          height: r.height,
        }));
      if (rects.length) out.push({ id: a.id, type: a.type, color: a.color, rects });
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

  return (
    <div ref={wrapRef} className="relative">
      <canvas
        ref={canvasRef}
        className="pdf-page block rounded shadow-lg ring-1 ring-black/10 dark:ring-white/10"
      />
      {/* Persisted marks, painted UNDER the text layer (click-through) so they
          never block selection; removal is a tap hit-test on the text layer. */}
      <div className="markLayer" aria-hidden>
        {marks.map((m) =>
          m.rects.map((r, i) => (
            <div key={`${m.id}:${i}`} style={markRectStyle(m.type, m.color, r)} />
          )),
        )}
      </div>
      {/* Transparent, selectable glyph boxes aligned over the canvas (on top). */}
      <div ref={textRef} className="textLayer" />
    </div>
  );
}
