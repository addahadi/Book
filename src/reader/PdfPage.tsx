import { useEffect, useRef } from 'react';
import { TextLayer, type PdfDocument, type TextLayerInstance } from './pdf';
import type { TextAnchor } from '../types';
import { anchorToRange, buildTextIndex, rangeToAnchor, type PageTextIndex } from './anchor';

type Props = {
  /** Loaded document to render from, or null while it loads. */
  doc: PdfDocument | null;
  /** 1-based page number to render. */
  page: number;
  /** CSS width (px) to render the page at — the page is fit to this width. */
  width: number;
  /** Reports the page's rendered CSS height once drawn, so the parent can
      compute how many bands it takes and clamp the last one. */
  onHeight?: (heightCss: number) => void;
  /** A saved selection to re-bind once the text layer (re)renders — proves an
      anchor round-trips across reload and survives re-render/zoom (issue #08). */
  restoreAnchor?: TextAnchor | null;
  /** Fired when the reader finishes a selection on this page (null if it can't
      be anchored). Only user pointer selections report; restores stay silent. */
  onSelect?: (anchor: TextAnchor | null) => void;
};

// Renders a whole PDF page to a canvas at a given CSS width (fit-width), with a
// pdf.js text layer aligned over it for selection. The canvas backing store is
// drawn at device resolution so text stays crisp on HiDPI screens; the text
// layer is laid out in CSS pixels (via `--scale-factor`) so its glyph boxes sit
// exactly over the painted glyphs. The parent clips this to the viewport and
// slides it up to reveal one band of the page at a time.
export default function PdfPage({ doc, page, width, onHeight, restoreAnchor, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef<PageTextIndex | null>(null);
  // Read the latest restore anchor without making it a render dependency, so a
  // new selection (which updates the prop) never forces a canvas re-render.
  const restoreRef = useRef(restoreAnchor);
  restoreRef.current = restoreAnchor;

  useEffect(() => {
    if (!doc || width <= 0) return;
    let cancelled = false;
    let textLayer: TextLayerInstance | null = null;
    indexRef.current = null;

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

      // Text layer, laid out in CSS pixels over the canvas. It uses the CSS-scale
      // viewport (NOT the dpr-scaled one), and `--scale-factor` must be set on
      // the container *before* construction — the TextLayer sizes the container
      // as `calc(var(--scale-factor) * pageWidth)` in its constructor.
      const container = textRef.current;
      if (!container) return;
      container.replaceChildren();
      container.style.setProperty('--scale-factor', String(scale));
      const textContent = await pdfPage.getTextContent();
      if (cancelled) return;
      textLayer = new TextLayer({
        textContentSource: textContent,
        container,
        viewport: pdfPage.getViewport({ scale }),
      });
      await textLayer.render();
      if (cancelled) {
        textLayer.cancel();
        return;
      }

      const index = buildTextIndex(textLayer.textDivs, textLayer.textContentItemsStr);
      indexRef.current = index;

      // Re-bind a saved selection for this page, unless the user already has a
      // live selection going (e.g. during a resize). Applying the actual DOM
      // selection is the most direct proof the anchor round-trips.
      const saved = restoreRef.current;
      if (saved) {
        const range = anchorToRange(index, saved);
        const sel = window.getSelection();
        if (range && sel && (sel.rangeCount === 0 || sel.isCollapsed)) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    })().catch(() => {
      /* render races are expected during fast turns; ignore. */
    });

    return () => {
      cancelled = true;
      textLayer?.cancel();
    };
  }, [doc, page, width, onHeight]);

  // Capture user selections on pointer-up. Restores apply the selection
  // programmatically (no pointer event), so they never loop back through here.
  useEffect(() => {
    const el = textRef.current;
    if (!el || !onSelect) return;
    const onUp = () => {
      const idx = indexRef.current;
      if (!idx) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) return;
      onSelect(rangeToAnchor(idx, range));
    };
    el.addEventListener('pointerup', onUp);
    return () => el.removeEventListener('pointerup', onUp);
  }, [onSelect]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="pdf-page block rounded shadow-lg ring-1 ring-black/10 dark:ring-white/10"
      />
      {/* Transparent, selectable glyph boxes aligned over the canvas. */}
      <div ref={textRef} className="textLayer" />
    </div>
  );
}
