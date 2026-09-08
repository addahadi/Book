import { useCallback, useEffect, useRef, useState } from 'react';
import type { PdfDocument } from './pdf';

// Full-text search over a born-digital book (issue #16). The book is indexed once
// per document by pulling each page's text with pdf.js `getTextContent()` — the
// same item strings the on-page text layer is built from (see ./anchor), joined
// the same way (no separators). That parity matters: a match's character offsets
// line up with the rendered layer, so the reader can highlight the exact run on
// jump (a stored `quote` re-locates it if extraction ever drifts). This never
// imports pdfjs-dist directly — it drives the typed page proxies (SPEC §7).

export type SearchMatch = {
  page: number;
  // Half-open character range of the match within the page's concatenated text —
  // the same offset space as a TextAnchor, so it becomes one directly on jump.
  startOffset: number;
  endOffset: number;
  quote: string; // the matched text, original case
  // Surrounding context for the results list, whitespace-tidied and elided.
  before: string;
  after: string;
};

// Characters of context shown on each side of a match in its snippet.
const CONTEXT = 48;
// Cap on total matches returned — a runaway query ("e") shouldn't build a
// thousand-row list. The status line notes when results were capped.
const MAX_RESULTS = 300;
// Pages indexed between progress bumps: coarse enough that indexing a big book
// doesn't thrash React, fine enough that results appear as they're found.
const INDEX_BATCH = 8;
// Shortest query we search on — one or two characters match nearly everything.
export const MIN_QUERY = 2;

function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function buildMatch(page: number, text: string, start: number, len: number): SearchMatch {
  const end = start + len;
  const before = (start - CONTEXT > 0 ? '…' : '') + tidy(text.slice(Math.max(0, start - CONTEXT), start));
  const after = tidy(text.slice(end, end + CONTEXT)) + (end + CONTEXT < text.length ? '…' : '');
  return { page, startOffset: start, endOffset: end, quote: text.slice(start, end), before, after };
}

export type BookSearch = {
  /** All matches for a query across every indexed page, in reading order. */
  search: (query: string) => { matches: SearchMatch[]; capped: boolean };
  /** Pages indexed so far (grows as the background pass runs). */
  indexed: number;
  /** Total pages in the book (0 until the document is open). */
  total: number;
  /** True while the background index is still being built. */
  indexing: boolean;
};

/**
 * Build a whole-book text index in the background and expose a synchronous
 * substring search over the pages indexed so far. Progressive by design: results
 * are searchable immediately and grow as later pages come in, so a large book
 * stays responsive (acceptance criterion). Re-indexes from scratch per document.
 */
export function useBookSearch(doc: PdfDocument | null): BookSearch {
  // Page text keyed by page number (index 0 unused), so lookups are O(1). A ref,
  // not state — mutating it as pages stream in shouldn't re-render on its own;
  // `indexed` is the state that publishes progress.
  const pagesRef = useRef<string[]>([]);
  const [indexed, setIndexed] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    pagesRef.current = [];
    setIndexed(0);
    setTotal(doc?.numPages ?? 0);
    if (!doc) return;
    let cancelled = false;
    (async () => {
      const n = doc.numPages;
      const store = new Array<string>(n + 1).fill('');
      pagesRef.current = store;
      for (let p = 1; p <= n; p++) {
        if (cancelled) return;
        try {
          const pg = await doc.getPage(p);
          const tc = await pg.getTextContent();
          if (cancelled) return;
          // Text items carry `str`; marked-content markers don't — skip those.
          store[p] = tc.items.map((it) => ('str' in it ? it.str : '')).join('');
        } catch {
          store[p] = ''; // a page that won't parse just contributes no matches
        }
        if (p % INDEX_BATCH === 0) setIndexed(p);
      }
      if (!cancelled) setIndexed(n);
    })();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  const search = useCallback(
    (query: string) => {
      const q = query.trim();
      if (q.length < MIN_QUERY) return { matches: [], capped: false };
      const needle = q.toLowerCase();
      const store = pagesRef.current;
      const matches: SearchMatch[] = [];
      for (let p = 1; p < store.length && p <= indexed; p++) {
        const text = store[p];
        if (!text) continue;
        const hay = text.toLowerCase();
        let from = 0;
        for (;;) {
          const at = hay.indexOf(needle, from);
          if (at === -1) break;
          matches.push(buildMatch(p, text, at, q.length));
          if (matches.length >= MAX_RESULTS) return { matches, capped: true };
          from = at + needle.length;
        }
      }
      return { matches, capped: false };
    },
    // `indexed` is a dependency so results recompute (and grow) as pages stream in.
    [indexed],
  );

  return { search, indexed, total, indexing: doc != null && total > 0 && indexed < total };
}
