import { useEffect, useRef, useState } from 'react';
import type { PdfDocument } from './pdf';

type Props = {
  /** Loaded document to render from, or null while it loads. */
  doc: PdfDocument | null;
  /** 1-based page number to render. */
  page: number;
};

// Renders a single PDF page to a canvas, fitted to its container. The spread
// layout composes two of these side by side; single-page layout uses one.
export default function PdfPage({ doc, page }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The available box (the flex cell wrapping this canvas). We fit the page
  // inside it, preserving aspect ratio, so nothing is stretched.
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent) return;
    const measure = () => setBox({ w: parent.clientWidth, h: parent.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || box.w === 0 || box.h === 0) return;
    let cancelled = false;
    (async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // "Contain" fit: the largest scale that keeps the whole page in the box.
      const base = pdfPage.getViewport({ scale: 1 });
      const fit = Math.min(box.w / base.width, box.h / base.height);
      const dpr = window.devicePixelRatio || 1;

      // Render the backing store at device resolution (fit × dpr) so text stays
      // crisp, while the CSS size is the fitted size — so it's never upscaled or
      // stretched: display pixels and backing pixels share one aspect ratio.
      const viewport = pdfPage.getViewport({ scale: fit * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${base.width * fit}px`;
      canvas.style.height = `${base.height * fit}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    })().catch(() => {
      /* render races are expected during fast turns; ignore. */
    });
    return () => {
      cancelled = true;
    };
  }, [doc, page, box.w, box.h]);

  return (
    <canvas
      ref={canvasRef}
      className="pdf-page rounded shadow-lg ring-1 ring-black/10 dark:ring-white/10"
    />
  );
}
