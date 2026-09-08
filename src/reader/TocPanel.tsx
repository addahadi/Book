import { useEffect, useMemo, useState } from 'react';
import type { OutlineNode } from './pdf';
import type { Annotation } from '../types';

// The embedded table of contents (issue #15): the PDF's own outline, rendered as
// a navigable tree on the left. Entries jump to their destination page; nested
// structure is preserved with indentation and collapse toggles. Presentational —
// the outline is read once in the parent (Reader) and handed down here.
//
// Bookmark-as-TOC fallback (issue #17): a book with no embedded outline uses the
// reader's own bookmarks as a hand-built contents list instead — ordered by
// page, showing each bookmark's name and colour, staying in sync as marks come
// and go.
type Props = {
  outline: OutlineNode[];
  /** The reader's bookmarks, in page order — the fallback contents when a book
      has no embedded outline (issue #17). */
  bookmarks: Annotation[];
  /** The page currently being read — used to flag the section you're in. */
  currentPage: number;
  /** Jump to an entry's destination page. */
  onJump: (page: number) => void;
  /** Close the panel. */
  onClose: () => void;
};

// A rendered node paired with its stable tree path ("0.2.1") — the key we use for
// collapse state and for marking the active entry, since titles aren't unique.
type Located = { node: OutlineNode; path: string; depth: number };

// The path of the entry that best marks "where you are": the navigable entry with
// the greatest destination page at or before the current page. Gives the reader a
// sense of place — the current chapter stays highlighted as they turn through it.
function activePathFor(outline: OutlineNode[], currentPage: number): string | null {
  // Flatten to (path, page) pairs first, then pick, so the choice is a plain
  // reduce rather than a mutation inside a recursive closure.
  const dests: { path: string; page: number }[] = [];
  const walk = (nodes: OutlineNode[], prefix: string) => {
    nodes.forEach((n, i) => {
      const path = prefix ? `${prefix}.${i}` : `${i}`;
      if (n.page != null) dests.push({ path, page: n.page });
      if (n.children.length) walk(n.children, path);
    });
  };
  walk(outline, '');

  let best: { path: string; page: number } | null = null;
  for (const d of dests) {
    if (d.page <= currentPage && (best === null || d.page >= best.page)) best = d;
  }
  return best === null ? null : best.path;
}

export default function TocPanel({ outline, bookmarks, currentPage, onJump, onClose }: Props) {
  // Paths of collapsed parents. Everything starts expanded so the whole structure
  // is visible; collapsing is opt-in for taming a deep outline.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const activePath = useMemo(
    () => activePathFor(outline, currentPage),
    [outline, currentPage],
  );

  // Fallback mode: no embedded outline, so bookmarks stand in as the contents.
  const useBookmarks = outline.length === 0;

  // The bookmark marking "where you are" — the one with the greatest page at or
  // before the current page — highlighted like the active outline entry.
  const activeBookmarkId = useMemo(() => {
    if (!useBookmarks) return null;
    let best: Annotation | null = null;
    for (const b of bookmarks) {
      if (b.page <= currentPage && (best === null || b.page >= best.page)) best = b;
    }
    return best?.id ?? null;
  }, [useBookmarks, bookmarks, currentPage]);

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // Flatten the visible tree in reading order, skipping the subtrees of collapsed
  // parents. Rendering a flat list keeps the markup simple and the rows uniform.
  const rows = useMemo(() => {
    const out: Located[] = [];
    const walk = (nodes: OutlineNode[], prefix: string, depth: number) => {
      nodes.forEach((n, i) => {
        const path = prefix ? `${prefix}.${i}` : `${i}`;
        out.push({ node: n, path, depth });
        if (n.children.length && !collapsed.has(path)) walk(n.children, path, depth + 1);
      });
    };
    walk(outline, '', 0);
    return out;
  }, [outline, collapsed]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label="Table of contents"
        className="fixed left-0 top-0 z-50 flex h-full w-full max-w-sm flex-col border-r border-black/10 bg-white text-neutral-900 shadow-2xl dark:border-white/10 dark:bg-stone-800 dark:text-stone-100"
      >
        <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
          <h2 className="text-base font-semibold">Contents</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close contents"
            className="rounded px-2 py-1 text-neutral-500 ring-1 ring-black/10 hover:bg-black/5 dark:text-neutral-400 dark:ring-white/10 dark:hover:bg-white/5"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto py-1">
          {useBookmarks ? (
            bookmarks.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
                This book has no embedded table of contents. Bookmark pages as you read and
                they'll appear here as your own contents list.
              </p>
            ) : (
              <>
                <p className="px-4 pb-1 pt-2 text-xs text-neutral-400 dark:text-neutral-500">
                  From your bookmarks
                </p>
                {bookmarks.map((b) => {
                  const isActive = b.id === activeBookmarkId;
                  return (
                    <div
                      key={b.id}
                      className={`flex items-center ${isActive ? 'bg-black/5 dark:bg-white/10' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => onJump(b.page)}
                        title={b.label ? `${b.label} — page ${b.page}` : `Page ${b.page}`}
                        className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 pr-3 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5 ${
                          isActive ? 'font-medium' : ''
                        }`}
                      >
                        <span
                          aria-hidden
                          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/20"
                          style={{ background: b.color ?? '#facc15' }}
                        />
                        <span
                          className={`min-w-0 flex-1 truncate ${
                            b.label ? '' : 'text-neutral-500 dark:text-neutral-400'
                          }`}
                        >
                          {b.label || `Page ${b.page}`}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                          {b.page}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </>
            )
          ) : (
            rows.map(({ node, path, depth }) => {
              const hasChildren = node.children.length > 0;
              const isCollapsed = collapsed.has(path);
              const isActive = path === activePath;
              const navigable = node.page != null;
              // Indent by depth; the chevron column keeps titles aligned whether or
              // not a row has children.
              const pad = 8 + depth * 16;
              return (
                <div
                  key={path}
                  className={`flex items-center ${
                    isActive ? 'bg-black/5 dark:bg-white/10' : ''
                  }`}
                >
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={() => toggle(path)}
                      aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
                      aria-expanded={!isCollapsed}
                      style={{ marginLeft: pad }}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10"
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        aria-hidden
                        className={`transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                      >
                        <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  ) : (
                    <span style={{ marginLeft: pad }} className="h-6 w-6 shrink-0" aria-hidden />
                  )}
                  <button
                    type="button"
                    disabled={!navigable}
                    onClick={() => navigable && onJump(node.page as number)}
                    title={node.title}
                    className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-3 text-left text-sm ${
                      navigable
                        ? 'hover:bg-black/5 dark:hover:bg-white/5'
                        : 'cursor-default text-neutral-500 dark:text-neutral-400'
                    } ${isActive ? 'font-medium' : ''}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{node.title}</span>
                    {navigable && (
                      <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                        {node.page}
                      </span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
