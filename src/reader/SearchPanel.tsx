import { useEffect, useMemo, useRef, useState } from 'react';
import { MIN_QUERY, type BookSearch, type SearchMatch } from './search';
import type { TextAnchor } from '../types';

// Full-text search sidebar (issue #16). A query box over the whole book, a live
// results list of page + surrounding snippet, and click-to-jump. Presentational:
// the index and the search function live in the parent (Reader), passed in via
// `book`, so the panel just drives the query and renders matches.
type Props = {
  book: BookSearch;
  currentPage: number;
  /** Jump to a match: its page, and the run to flash-highlight there. */
  onJump: (page: number, anchor: TextAnchor) => void;
  onClose: () => void;
};

// Debounce (ms) before a keystroke runs a search — lets a fast typist finish a
// word before we scan the book.
const DEBOUNCE_MS = 160;

// The TextAnchor a match resolves to on the page (issue #08 offset space).
function anchorOf(m: SearchMatch): TextAnchor {
  return { kind: 'text', startOffset: m.startOffset, endOffset: m.endOffset, quote: m.quote };
}

export default function SearchPanel({ book, currentPage, onJump, onClose }: Props) {
  const { search, indexed, total, indexing } = book;
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the box on open so you can type straight away.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Re-run when the query settles or more pages finish indexing (search identity
  // changes with `indexed`), so results fill in progressively for a big book.
  const { matches, capped } = useMemo(() => search(debounced), [search, debounced]);
  const trimmed = debounced.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_QUERY;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label="Search"
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col border-l border-black/10 bg-white text-neutral-900 shadow-2xl dark:border-white/10 dark:bg-stone-800 dark:text-stone-100"
      >
        <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
          <h2 className="text-base font-semibold">Search</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="rounded px-2 py-1 text-neutral-500 ring-1 ring-black/10 hover:bg-black/5 dark:text-neutral-400 dark:ring-white/10 dark:hover:bg-white/5"
          >
            ✕
          </button>
        </div>

        <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
          <div className="relative">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="search"
              placeholder="Search this book…"
              aria-label="Search this book"
              className="w-full rounded border border-black/10 bg-transparent py-1.5 pl-3 pr-8 text-sm outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/30"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                ✕
              </button>
            )}
          </div>
          {/* Status: match count, plus an indexing note while the book is still
              being scanned so a not-yet-complete result set is honest. */}
          <div className="mt-2 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
            <span>
              {trimmed.length >= MIN_QUERY
                ? `${matches.length}${capped ? '+' : ''} ${matches.length === 1 ? 'match' : 'matches'}`
                : ''}
            </span>
            {indexing && (
              <span className="tabular-nums">
                Indexing… {indexed}/{total}
              </span>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {trimmed.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
              Type to search across every page of the book.
            </p>
          ) : tooShort ? (
            <p className="px-4 py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
              Keep typing — enter at least {MIN_QUERY} characters.
            </p>
          ) : matches.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
              No matches for “{trimmed}”.
              {indexing && ' Still indexing — more may appear.'}
            </p>
          ) : (
            matches.map((m) => (
              <button
                key={`${m.page}:${m.startOffset}`}
                type="button"
                onClick={() => onJump(m.page, anchorOf(m))}
                className="flex w-full items-start gap-3 border-b border-black/5 px-4 py-2.5 text-left hover:bg-black/5 dark:border-white/5 dark:hover:bg-white/5"
              >
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] tabular-nums ${
                    m.page === currentPage
                      ? 'bg-black/10 dark:bg-white/15'
                      : 'text-neutral-500 dark:text-neutral-400'
                  }`}
                >
                  p.{m.page}
                </span>
                <span className="min-w-0 flex-1 text-sm leading-snug">
                  <span className="text-neutral-500 dark:text-neutral-400">{m.before}</span>
                  <mark className="rounded-sm bg-yellow-300/70 px-0.5 text-neutral-900 dark:bg-yellow-400/70">
                    {m.quote}
                  </mark>
                  <span className="text-neutral-500 dark:text-neutral-400">{m.after}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
