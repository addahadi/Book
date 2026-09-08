import { useEffect, useState } from 'react';
import { loadOutline, type OutlineNode, type PdfDocument } from './pdf';

/**
 * Read the open document's embedded outline once per document (issue #15). Kept
 * as its own hook so the resolve-every-destination pass runs a single time on
 * open, not on every page turn. `outline` is an empty array both while loading
 * and for a book that has no outline at all — the TOC panel treats the two the
 * same (a "no contents" fallback, #17), so no separate loading flag is needed.
 */
export function useOutline(doc: PdfDocument | null): OutlineNode[] {
  const [outline, setOutline] = useState<OutlineNode[]>([]);

  useEffect(() => {
    if (!doc) {
      setOutline([]);
      return;
    }
    let cancelled = false;
    setOutline([]);
    loadOutline(doc)
      .then((nodes) => !cancelled && setOutline(nodes))
      .catch(() => !cancelled && setOutline([]));
    return () => {
      cancelled = true;
    };
  }, [doc]);

  return outline;
}
