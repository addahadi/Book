import { useEffect, useRef, useState } from 'react';
import PdfPage from './PdfPage';
import PositionIndicator from './PositionIndicator';
import { usePdfDocument } from './usePdfDocument';
import { getBook } from '../db/library';
import { useLibrary } from '../store/library';
import { useReader } from '../store/reader';
import { useTheme } from '../store/theme';

// Distance (px) a touch must travel horizontally to count as a page-turn swipe.
const SWIPE_THRESHOLD = 50;
// Below this width we drop the spread and show a single page (tablet/narrow).
const SPREAD_MIN_WIDTH = '(min-width: 1024px)';

// The paginated reader for one open book. Its bytes come from IndexedDB; the
// shelf (App) decides which book is open.
export default function Reader({ bookId }: { bookId: string }) {
  const closeBook = useLibrary((s) => s.closeBook);
  const {
    currentPage,
    numPages,
    spread,
    setNumPages,
    setSpread,
    nextPage,
    prevPage,
    goToPage,
  } = useReader();
  const { theme, toggle: toggleTheme } = useTheme();

  const [data, setData] = useState<Uint8Array | null>(null);
  const [title, setTitle] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const touchStartX = useRef<number | null>(null);

  // Load this book's bytes and reset the reader to page 1 so opening a book
  // never lands you mid-way through it. Falls back to the shelf if the book was
  // removed out from under us.
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setTitle('');
    setLoadError(null);
    setNumPages(0);
    goToPage(1);
    getBook(bookId)
      .then(async (book) => {
        if (cancelled) return;
        if (!book) {
          closeBook();
          return;
        }
        setTitle(book.title);
        const buf = await book.bytes.arrayBuffer();
        if (!cancelled) setData(new Uint8Array(buf));
      })
      .catch((e) => !cancelled && setLoadError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [bookId, closeBook, setNumPages, goToPage]);

  const { doc, error: renderError } = usePdfDocument(data);
  const error = loadError ?? renderError;

  const atStart = currentPage <= 1;
  const atEnd = numPages > 0 && currentPage >= numPages;
  // The spread's right page only exists when there's a page after the left one.
  const rightPage = spread && currentPage < numPages ? currentPage + 1 : null;

  // Publish the loaded document's page count to the store.
  useEffect(() => {
    if (doc) setNumPages(doc.numPages);
  }, [doc, setNumPages]);

  // Track viewport width → spread vs single. Switches automatically on resize.
  useEffect(() => {
    const mql = window.matchMedia(SPREAD_MIN_WIDTH);
    const apply = () => setSpread(mql.matches);
    apply();
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, [setSpread]);

  // ← / → keys turn pages. Bound once; the store reads live state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack arrows while typing in a field (e.g. go-to-page).
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))
        return;
      if (e.key === 'ArrowRight') nextPage();
      else if (e.key === 'ArrowLeft') prevPage();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextPage, prevPage]);

  // Click/tap the left or right half of the reading surface to turn.
  const onSurfaceClick = (e: React.MouseEvent<HTMLElement>) => {
    const { left, width } = e.currentTarget.getBoundingClientRect();
    if (e.clientX - left < width / 2) prevPage();
    else nextPage();
  };

  // Swipe left/right on touch devices.
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? start) - start;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    // Swipe right-to-left (dx < 0) advances, like turning a page forward.
    if (dx < 0) nextPage();
    else prevPage();
  };

  return (
    <div className="flex h-full flex-col bg-neutral-100 text-neutral-900 dark:bg-stone-900 dark:text-stone-100">
      <header className="flex items-center justify-between border-b border-black/10 px-4 py-2 text-sm dark:border-white/10">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={closeBook}
            aria-label="Back to library"
            className="rounded px-2 py-1 ring-1 ring-black/10 hover:bg-black/5 dark:ring-white/10 dark:hover:bg-white/5"
          >
            ← Library
          </button>
          <span className="truncate font-semibold" title={title}>
            {title}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleTheme}
            aria-pressed={theme === 'dark'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to night mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to night mode'}
            className="rounded px-2 py-1 ring-1 ring-black/10 hover:bg-black/5 dark:ring-white/10 dark:hover:bg-white/5"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
            page {currentPage}
            {rightPage ? `–${rightPage}` : ''}
            {numPages ? ` of ${numPages}` : ''}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={prevPage}
              disabled={atStart}
              aria-label="Previous page"
              className="rounded px-2 py-1 ring-1 ring-black/10 enabled:hover:bg-black/5 disabled:opacity-40 dark:ring-white/10 dark:enabled:hover:bg-white/5"
            >
              ←
            </button>
            <button
              type="button"
              onClick={nextPage}
              disabled={atEnd}
              aria-label="Next page"
              className="rounded px-2 py-1 ring-1 ring-black/10 enabled:hover:bg-black/5 disabled:opacity-40 dark:ring-white/10 dark:enabled:hover:bg-white/5"
            >
              →
            </button>
          </div>
        </div>
      </header>
      <main
        onClick={onSurfaceClick}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="flex flex-1 select-none items-center justify-center gap-2 overflow-hidden p-6"
      >
        {error ? (
          <div className="p-6 text-sm text-red-600 dark:text-red-400">
            Failed to render PDF: {error}
          </div>
        ) : (
          <>
            {/* Each page gets a bounded flex cell so it can fit itself to the
                space (half the width in a spread), preserving aspect ratio. */}
            <div className="flex h-full min-w-0 flex-1 items-center justify-center">
              <PdfPage doc={doc} page={currentPage} />
            </div>
            {rightPage && (
              <div className="flex h-full min-w-0 flex-1 items-center justify-center">
                <PdfPage doc={doc} page={rightPage} />
              </div>
            )}
          </>
        )}
      </main>
      <footer className="border-t border-black/10 px-4 py-2 dark:border-white/10">
        <PositionIndicator />
      </footer>
    </div>
  );
}
