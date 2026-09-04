import { useEffect, useRef } from 'react';
import type { PdfDocument } from './pdf';

type Props = {
  /** Loaded document to render from, or null while it loads. */
  doc: PdfDocument | null;
  /** 1-based page number to render. */
  page: number;
};

// Renders a single PDF page to a canvas. The spread layout composes two of
// these side by side; single-page layout uses one.
export default function PdfPage({ doc, page }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const viewport = pdfPage.getViewport({ scale: 1.5 });
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    })().catch(() => {
      /* render races are expected during fast turns; ignore. */
    });
    return () => {
      cancelled = true;
    };
  }, [doc, page]);

  return (
    <canvas
      ref={canvasRef}
      className="max-h-full rounded shadow-lg ring-1 ring-black/10 dark:ring-white/10"
    />
  );
}
