// Text anchoring for born-digital PDFs — the M3 spike (issue #08).
//
// A page's canonical text is the in-order concatenation of pdf.js text items
// (`TextLayer.textContentItemsStr`). Each rendered text span (`textDivs[i]`)
// holds item `i`'s string, and the two arrays run parallel. An anchor is a
// half-open `[startOffset, endOffset)` range of character offsets into that
// concatenation, plus the quoted substring as a re-binding fallback.
//
// Why offsets, not geometry: offsets are layout-independent, so an anchor
// survives a re-render or a zoom — only the DOM rectangles change, never the
// character positions. See `TextAnchor` in `src/types.ts`.

import type { TextAnchor } from '../types';

// A resolved map between a page's rendered text spans and its canonical string.
// Rebuilt each time the text layer renders (it depends on the live DOM nodes).
export type PageTextIndex = {
  // The per-item spans, parallel to `starts` (from `TextLayer.textDivs`).
  divs: HTMLElement[];
  // Cumulative start offset of each item's text within `text`.
  starts: number[];
  // The full concatenated page text.
  text: string;
};

/** Build the offset index from the parallel arrays a rendered TextLayer exposes. */
export function buildTextIndex(divs: HTMLElement[], strs: string[]): PageTextIndex {
  const starts: number[] = [];
  let acc = 0;
  for (let i = 0; i < strs.length; i++) {
    starts.push(acc);
    acc += strs[i].length;
  }
  return { divs, starts, text: strs.join('') };
}

// Length of item `i`'s text (the gap to the next item's start, or to the end).
function itemLen(idx: PageTextIndex, i: number): number {
  const end = i + 1 < idx.starts.length ? idx.starts[i + 1] : idx.text.length;
  return end - idx.starts[i];
}

// The first text node inside a span (pdf.js puts each item's string in one).
function firstTextNode(el: HTMLElement): Text | null {
  for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) return n as Text;
  return null;
}

// Map a DOM point (container + offset) to a character offset in the page text.
// The point's text node sits inside one of the item spans (possibly nested in a
// `markedContent` wrapper), so we walk up until we hit a span we indexed.
function pointToOffset(idx: PageTextIndex, node: Node, offset: number): number | null {
  let cur: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  let divIndex = -1;
  while (cur && divIndex === -1) {
    divIndex = idx.divs.indexOf(cur as HTMLElement);
    cur = cur.parentNode;
  }
  if (divIndex === -1) return null;

  let local: number;
  if (node.nodeType === Node.TEXT_NODE) {
    local = offset;
  } else {
    // Element point: `offset` counts child nodes before the point; sum their text.
    local = 0;
    const kids = (node as HTMLElement).childNodes;
    for (let i = 0; i < offset && i < kids.length; i++) {
      local += (kids[i].textContent ?? '').length;
    }
  }
  return idx.starts[divIndex] + local;
}

// Map a character offset back to a DOM point, skipping zero-length items (EOL
// spans pdf.js keeps in the array but never puts in the DOM).
function offsetToPoint(
  idx: PageTextIndex,
  offset: number,
): { node: Node; offset: number } | null {
  for (let i = idx.divs.length - 1; i >= 0; i--) {
    const len = itemLen(idx, i);
    if (len === 0) continue;
    if (idx.starts[i] <= offset) {
      const local = Math.min(offset - idx.starts[i], len);
      const text = firstTextNode(idx.divs[i]);
      return text ? { node: text, offset: local } : { node: idx.divs[i], offset: 0 };
    }
  }
  // Offset lands before the first non-empty item.
  const first = idx.divs.find((_, i) => itemLen(idx, i) > 0);
  if (!first) return null;
  const text = firstTextNode(first);
  return text ? { node: text, offset: 0 } : { node: first, offset: 0 };
}

/** Resolve a live DOM selection range to a serializable anchor, or null. */
export function rangeToAnchor(idx: PageTextIndex, range: Range): TextAnchor | null {
  const a = pointToOffset(idx, range.startContainer, range.startOffset);
  const b = pointToOffset(idx, range.endContainer, range.endOffset);
  if (a === null || b === null) return null;
  const startOffset = Math.min(a, b);
  const endOffset = Math.max(a, b);
  if (endOffset <= startOffset) return null;
  return { kind: 'text', startOffset, endOffset, quote: idx.text.slice(startOffset, endOffset) };
}

/**
 * Resolve an anchor back to a DOM range against a freshly rendered layer. If the
 * quoted text no longer sits at the stored offsets (extraction drifted across
 * pdf.js versions), relocate it by searching for the quote.
 */
export function anchorToRange(idx: PageTextIndex, anchor: TextAnchor): Range | null {
  let { startOffset, endOffset } = anchor;
  if (anchor.quote && idx.text.slice(startOffset, endOffset) !== anchor.quote) {
    const found = idx.text.indexOf(anchor.quote);
    if (found === -1) return null;
    startOffset = found;
    endOffset = found + anchor.quote.length;
  }
  const start = offsetToPoint(idx, startOffset);
  const end = offsetToPoint(idx, endOffset);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}
