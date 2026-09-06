import { useState } from 'react';
import { HIGHLIGHT_COLORS } from './marks';
import type { Annotation } from '../types';

// The header controls for page-level bookmarks / dog-ears (issue #11): a toggle
// that bookmarks the current page (and opens an editor to name + colour it), and
// a list that jumps to any bookmark in the book. All state lives in the parent
// (the annotation sidecar); this is presentational.
type Props = {
  /** Every bookmark in the book, sorted by page. */
  bookmarks: Annotation[];
  currentPage: number;
  /** Create a bookmark on the current page (default colour, unnamed). */
  onAdd: () => void;
  onUpdate: (id: string, changes: { label?: string; color?: string }) => void;
  onRemove: (id: string) => void;
  onJump: (page: number) => void;
};

const DEFAULT_COLOR = HIGHLIGHT_COLORS[0].value;

export default function BookmarkControls({
  bookmarks,
  currentPage,
  onAdd,
  onUpdate,
  onRemove,
  onJump,
}: Props) {
  const [open, setOpen] = useState<null | 'edit' | 'list'>(null);
  const current = bookmarks.find((b) => b.page === currentPage);
  const close = () => setOpen(null);

  const btn =
    'rounded px-2 py-1 ring-1 ring-black/10 hover:bg-black/5 dark:ring-white/10 dark:hover:bg-white/5';

  // Bookmarking an unbookmarked page creates the mark, then opens the editor so
  // it can be named / recoloured right away.
  const toggleEdit = () => {
    if (!current) onAdd();
    setOpen((o) => (o === 'edit' ? null : 'edit'));
  };

  const panel =
    'absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-black/10 bg-white ' +
    'text-neutral-900 shadow-xl dark:border-white/10 dark:bg-stone-800 dark:text-stone-100';

  return (
    <div className="relative flex items-center gap-1">
      <button
        type="button"
        onClick={toggleEdit}
        aria-pressed={!!current}
        aria-label={current ? 'Edit bookmark' : 'Bookmark this page'}
        title={current ? 'Edit bookmark' : 'Bookmark this page'}
        className={btn}
      >
        <svg width="13" height="16" viewBox="0 0 14 18" aria-hidden className="block">
          <path
            d="M2 1h10a1 1 0 0 1 1 1v14l-6-4-6 4V2a1 1 0 0 1 1-1z"
            fill={current ? (current.color ?? DEFAULT_COLOR) : 'none'}
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <button
        type="button"
        onClick={() => setOpen((o) => (o === 'list' ? null : 'list'))}
        aria-label="All bookmarks"
        title="All bookmarks"
        className={`${btn} flex items-center gap-1`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="block">
          <path
            d="M2 4h12M2 8h12M2 12h8"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        {bookmarks.length > 0 && (
          <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
            {bookmarks.length}
          </span>
        )}
      </button>

      {open === 'edit' && current && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div className={`${panel} p-3`}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                Bookmark · page {current.page}
              </span>
              <button
                type="button"
                onClick={() => {
                  onRemove(current.id);
                  close();
                }}
                className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
              >
                Remove
              </button>
            </div>
            <input
              autoFocus
              value={current.label ?? ''}
              onChange={(e) => onUpdate(current.id, { label: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') close();
              }}
              placeholder="Name this bookmark…"
              className="mb-3 w-full rounded border border-black/10 bg-transparent px-2 py-1 text-sm outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/30"
            />
            <div className="flex items-center gap-2">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => onUpdate(current.id, { color: c.value })}
                  aria-label={c.name}
                  title={c.name}
                  className="h-6 w-6 rounded-full ring-1 ring-black/15 dark:ring-white/20"
                  style={{
                    background: c.value,
                    outline:
                      (current.color ?? DEFAULT_COLOR) === c.value ? '2px solid currentColor' : 'none',
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {open === 'list' && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div className={`${panel} max-h-80 overflow-auto p-1`}>
            {bookmarks.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
                No bookmarks yet.
              </div>
            ) : (
              bookmarks.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-1 rounded px-1 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onJump(b.page);
                      close();
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1.5 text-left"
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/15 dark:ring-white/20"
                      style={{ background: b.color ?? DEFAULT_COLOR }}
                    />
                    <span className="truncate text-sm">{b.label || `Page ${b.page}`}</span>
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                      p.{b.page}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(b.id)}
                    aria-label={`Remove bookmark on page ${b.page}`}
                    title="Remove"
                    className="shrink-0 rounded px-1.5 py-1 text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
