import { useEffect, useMemo, useState } from 'react';
import { HIGHLIGHT_COLORS, inkOf } from './marks';
import { buildCopyText, useCopyFeedback } from './copy';
import AnnotationDetail from './AnnotationDetail';
import type { Annotation } from '../types';

// The per-book Notebook (issue #13): every highlight, note, and bookmark in the
// book, listed in reading order (page, then position on the page). Clicking an
// entry jumps to its page; the list can be narrowed to a single highlight colour.
// Presentational — the annotation sidecar lives in the parent (Reader), so the
// list updates live as marks are added or removed, with no fetch of its own.
type Props = {
  /** Every annotation in the book (unsorted; this panel orders them). */
  annotations: Annotation[];
  /** The book's title, shown in an entry's detail view (issue #14). */
  bookTitle: string;
  /** The page currently being read, flagged in the list for a sense of place. */
  currentPage: number;
  /** Jump to an entry's page (fired from a detail view's "Go to source"). */
  onJump: (page: number) => void;
  /** Close the panel. */
  onClose: () => void;
};

// A mark's position within its page, for the secondary sort. Text runs order by
// character offset; region boxes by their top edge. A page-level bookmark has no
// in-page anchor, so it sorts to the very top of its page.
function positionOf(a: Annotation): number {
  if (a.anchor?.kind === 'text') return a.anchor.startOffset;
  if (a.anchor?.kind === 'region') return a.anchor.y;
  return -1;
}

export const TYPE_LABEL: Record<Annotation['type'], string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strike: 'Strikethrough',
  note: 'Note',
  bookmark: 'Bookmark',
  region: 'Region',
};

// The line of text an entry shows: the quoted run for text marks, the note body
// for a standalone note, the label (or page) for a bookmark.
function entryText(a: Annotation): string {
  if (a.type === 'note') return a.note || 'Empty note';
  if (a.type === 'bookmark') return a.label || `Page ${a.page}`;
  if (a.type === 'region') return 'Region highlight';
  return a.anchor?.kind === 'text' ? (a.anchor.quote ?? '') : '';
}

// A small, crisp type icon in the mark's ink, so entries are distinguishable at
// a glance without relying on colour alone. Shared with the detail view (#14).
// The copy affordance, shared by the detail view's Copy button and the revealed
// row icons: two offset sheets, the classic "copy" glyph.
export function CopyIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TypeIcon({ type, ink }: { type: Annotation['type']; ink: string }) {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true } as const;
  switch (type) {
    case 'highlight':
      return (
        <svg {...common}>
          <rect x="2" y="4" width="12" height="8" rx="1.5" fill={ink} />
        </svg>
      );
    case 'underline':
      return (
        <svg {...common} fill="none" stroke={ink} strokeLinecap="round">
          <path d="M4 3v4a4 4 0 0 0 8 0V3" strokeWidth="1.4" />
          <path d="M3 13h10" strokeWidth="1.6" />
        </svg>
      );
    case 'strike':
      return (
        <svg {...common} fill="none" stroke={ink} strokeLinecap="round">
          <path d="M4 4h8M6 4v3M10 4v3" strokeWidth="1.2" opacity="0.55" />
          <path d="M3 9h10" strokeWidth="1.6" />
        </svg>
      );
    case 'note':
      return (
        <svg {...common} fill="none" stroke={ink} strokeLinejoin="round" strokeLinecap="round">
          <path d="M10.5 2.5l3 3L6 13l-3.5.5L3 10z" strokeWidth="1.3" />
        </svg>
      );
    case 'bookmark':
      return (
        <svg {...common} fill="none" stroke={ink} strokeLinejoin="round">
          <path d="M4 2h8a1 1 0 0 1 1 1v11l-5-3.2L3 14V3a1 1 0 0 1 1-1z" strokeWidth="1.3" fill={ink} />
        </svg>
      );
    case 'region':
      return (
        <svg {...common} fill="none" stroke={ink}>
          <rect x="2.5" y="3.5" width="11" height="9" rx="1" strokeWidth="1.3" strokeDasharray="2.4 2" />
        </svg>
      );
  }
}

export default function NotebookPanel({
  annotations,
  bookTitle,
  currentPage,
  onJump,
  onClose,
}: Props) {
  // The active colour filter (a highlight-colour hex), or null for "all".
  const [filter, setFilter] = useState<string | null>(null);
  // The entry whose detail view is open (issue #14), addressed by its stable id,
  // or null while the list is showing. Resolved against live state, so a mark
  // removed elsewhere drops us cleanly back to the list.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? annotations.find((a) => a.id === selectedId) : undefined;
  // Copy-to-clipboard feedback, keyed by mark id so only the copied row shows ✓.
  const { copiedKey, copy } = useCopyFeedback();

  // Escape steps back: from a detail view to the list, then out of the panel —
  // matching the other floating surfaces.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selectedId) setSelectedId(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, selectedId]);

  // Reading order — page, then in-page position, then creation as a stable
  // tiebreak — grouped under a per-page heading. Recomputed whenever the sidecar
  // changes (add/remove) or the filter narrows the set, so the list stays live.
  const groups = useMemo(() => {
    const kept = filter ? annotations.filter((a) => inkOf(a) === filter) : annotations;
    const sorted = [...kept].sort(
      (a, b) => a.page - b.page || positionOf(a) - positionOf(b) || a.createdAt - b.createdAt,
    );
    const out: { page: number; items: Annotation[] }[] = [];
    for (const a of sorted) {
      const last = out[out.length - 1];
      if (last && last.page === a.page) last.items.push(a);
      else out.push({ page: a.page, items: [a] });
    }
    return out;
  }, [annotations, filter]);

  const total = annotations.length;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label="Notebook"
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col border-l border-black/10 bg-white text-neutral-900 shadow-2xl dark:border-white/10 dark:bg-stone-800 dark:text-stone-100"
      >
        {selected ? (
          <AnnotationDetail
            annotation={selected}
            bookTitle={bookTitle}
            onBack={() => setSelectedId(null)}
            onGoToSource={onJump}
          />
        ) : (
          <>
        <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
          <div className="flex items-baseline gap-2">
            <h2 className="text-base font-semibold">Notebook</h2>
            <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
              {total} {total === 1 ? 'entry' : 'entries'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notebook"
            className="rounded px-2 py-1 text-neutral-500 ring-1 ring-black/10 hover:bg-black/5 dark:text-neutral-400 dark:ring-white/10 dark:hover:bg-white/5"
          >
            ✕
          </button>
        </div>

        {/* Colour filter: "All", then a swatch per highlight colour. */}
        <div className="flex items-center gap-2 border-b border-black/10 px-4 py-2 dark:border-white/10">
          <span className="text-xs text-neutral-500 dark:text-neutral-400">Filter</span>
          <button
            type="button"
            onClick={() => setFilter(null)}
            className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
              filter === null
                ? 'bg-black/10 ring-black/20 dark:bg-white/15 dark:ring-white/25'
                : 'ring-black/10 hover:bg-black/5 dark:ring-white/10 dark:hover:bg-white/5'
            }`}
          >
            All
          </button>
          <div className="flex items-center gap-1.5">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setFilter((f) => (f === c.value ? null : c.value))}
                aria-label={`Filter by ${c.name}`}
                aria-pressed={filter === c.value}
                title={c.name}
                className="h-5 w-5 rounded-full ring-1 ring-black/15 dark:ring-white/20"
                style={{
                  background: c.value,
                  outline: filter === c.value ? '2px solid currentColor' : 'none',
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {total === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
              No highlights, notes, or bookmarks yet. Select some text or bookmark a page to start
              your notebook.
            </p>
          ) : groups.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
              Nothing in this colour.
            </p>
          ) : (
            groups.map((g) => (
              <section key={g.page}>
                <div
                  className={`sticky top-0 flex items-center gap-2 bg-white/95 px-4 py-1.5 text-xs font-medium backdrop-blur dark:bg-stone-800/95 ${
                    g.page === currentPage
                      ? 'text-neutral-900 dark:text-stone-100'
                      : 'text-neutral-500 dark:text-neutral-400'
                  }`}
                >
                  Page {g.page}
                  {g.page === currentPage && (
                    <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-normal dark:bg-white/15">
                      reading
                    </span>
                  )}
                </div>
                {g.items.map((a) => {
                  const ink = inkOf(a);
                  const hasSideNote = a.type !== 'note' && !!a.note;
                  const copied = copiedKey === a.id;
                  return (
                    <div key={a.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => setSelectedId(a.id)}
                        style={{ borderLeftColor: ink }}
                        className="flex w-full items-start gap-3 border-l-[3px] py-2.5 pl-4 pr-10 text-left hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <span
                          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded"
                          style={{ background: `${ink}22` }}
                        >
                          <TypeIcon type={a.type} ink={ink} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                            {TYPE_LABEL[a.type]}
                            {hasSideNote && <span title="Has a margin note">✎</span>}
                          </span>
                          <span
                            className={`mt-0.5 block break-words text-sm ${
                              a.type === 'highlight' || a.type === 'underline' || a.type === 'strike'
                                ? 'italic'
                                : ''
                            }`}
                            style={{
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {entryText(a)}
                          </span>
                        </span>
                      </button>
                      {/* Copy stays out of the way — revealed on hover/focus so the
                          dense list keeps scanning cleanly (grill decision). */}
                      <button
                        type="button"
                        onClick={() => copy(a.id, buildCopyText(a, bookTitle))}
                        aria-label="Copy mark to clipboard"
                        title="Copy"
                        className={`absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded text-neutral-500 ring-1 ring-black/10 transition hover:bg-black/5 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 dark:text-neutral-400 dark:ring-white/10 dark:hover:bg-white/5 ${
                          copied ? 'opacity-100' : 'opacity-0'
                        }`}
                      >
                        {copied ? <span className="text-xs">✓</span> : <CopyIcon />}
                      </button>
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </div>
          </>
        )}
      </aside>
    </>
  );
}
