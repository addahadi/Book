import { useEffect, useRef, useState } from 'react';
import { loadDocument, type PdfDocument } from './pdf';
import { useReader } from '../store/reader';

type Props = {
  /** URL or bytes of the PDF to render. */
  src: string | ArrayBuffer | Uint8Array;
};

// M0 walking skeleton: render the current page of a PDF to a canvas.
// Pagination controls, spread layout and text/annotation layers arrive in later tickets.
export default function PdfCanvas({ src }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentPage = useReader((s) => s.currentPage);
  const setNumPages = useReader((s) => s.setNumPages);

  // Load the document once per src.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadDocument(src)
      .then((d) => {
        if (cancelled) return;
        setDoc(d);
        setNumPages(d.numPages);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [src, setNumPages]);

  // Render the current page whenever it (or the doc) changes.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(currentPage);
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: 1.5 });
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      await page.render({ canvasContext: ctx, viewport }).promise;
    })().catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [doc, currentPage]);

  if (error) {
    return (
      <div className="p-6 text-sm text-red-600 dark:text-red-400">
        Failed to render PDF: {error}
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="rounded shadow-lg ring-1 ring-black/10 dark:ring-white/10"
    />
  );
}
