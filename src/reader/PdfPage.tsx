import { useEffect, useRef } from 'react';
import type { PdfDocument } from './pdf';

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
};

// Renders a whole PDF page to a canvas at a given CSS width (fit-width). The
// backing store is drawn at device resolution so text stays crisp on HiDPI
// screens; the parent clips this canvas to the viewport and slides it up to
// reveal one band of the page at a time.
export default function PdfPage({ doc, page, width, onHeight }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!doc || width <= 0) return;
    let cancelled = false;
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
      if (!cancelled) onHeight?.(heightCss);
    })().catch(() => {
      /* render races are expected during fast turns; ignore. */
    });
    return () => {
      cancelled = true;
    };
  }, [doc, page, width, onHeight]);

  return (
    <canvas
      ref={canvasRef}
      className="pdf-page block rounded shadow-lg ring-1 ring-black/10 dark:ring-white/10"
    />
  );
}
