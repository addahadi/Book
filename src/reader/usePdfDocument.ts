import { useEffect, useState } from 'react';
import { loadDocument, type PdfDocument } from './pdf';

/**
 * Load a PDF document once per `src`. Kept separate from page rendering so a
 * two-page spread can share a single loaded document across both page canvases.
 */
export function usePdfDocument(src: string | ArrayBuffer | Uint8Array) {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDoc(null);
    loadDocument(src)
      .then((d) => !cancelled && setDoc(d))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [src]);

  return { doc, error };
}
