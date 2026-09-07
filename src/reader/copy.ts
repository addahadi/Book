import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation } from '../types';

// Copy-a-mark-to-clipboard (grill decision, 2026-09-07): a v1-safe convenience
// on top of the notebook / detail surfaces (#13/#14). Deliberately PLAIN TEXT,
// not Markdown — a real Markdown/Obsidian export stays post-v1 (SPEC §10), and
// making copy emit a citation-styled block would quietly pre-build it. If you
// find yourself copying constantly, that's the dogfood signal to promote export.

// The text a mark quotes, if any: the anchored run for a text mark, else a
// bookmark's label. Region boxes and bare bookmarks quote nothing.
function excerptOf(a: Annotation): string | null {
  if (a.anchor?.kind === 'text' && a.anchor.quote) return a.anchor.quote.trim();
  if (a.type === 'bookmark' && a.label) return a.label.trim();
  return null;
}

// Assemble the clipboard form from whatever parts the mark has, skipping the
// empties so there are never blank lines: excerpt (quoted) → note → citation.
// The citation is always present — every mark has a book and a page — so even a
// bare region copies its "— Book, p.N" locator, which is still useful.
export function buildCopyText(a: Annotation, bookTitle: string): string {
  const parts: string[] = [];
  const excerpt = excerptOf(a);
  if (excerpt) parts.push(`"${excerpt}"`);
  const note = a.note?.trim();
  if (note) parts.push(note);
  parts.push(`— ${bookTitle || 'Untitled'}, p.${a.page}`);
  return parts.join('\n');
}

// A tiny keyed copy-with-feedback hook, shared by the detail view (one button)
// and the notebook rows (one revealed icon each). `copiedKey` names the mark
// last copied, so a row shows "✓" without every row flipping at once. Clipboard
// failures (insecure context / denied permission) fail quietly — copy is a
// convenience, never a critical path.
export function useCopyFeedback(timeout = 1500) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (key: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedKey(key);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopiedKey(null), timeout);
      } catch {
        // Clipboard unavailable — leave the UI unchanged.
      }
    },
    [timeout],
  );

  return { copiedKey, copy };
}
