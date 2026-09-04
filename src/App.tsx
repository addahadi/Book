import { useEffect, useRef } from 'react';
import PdfPage from './reader/PdfPage';
import PositionIndicator from './reader/PositionIndicator';
import { usePdfDocument } from './reader/usePdfDocument';
import { useReader } from './store/reader';
import { useTheme } from './store/theme';
import samplePdf from './assets/sample.pdf?url';

// Distance (px) a touch must travel horizontally to count as a page-turn swipe.
const SWIPE_THRESHOLD = 50;
// Below this width we drop the spread and show a single page (tablet/narrow).
const SPREAD_MIN_WIDTH = '(min-width: 1024px)';

export default function App() {
  const { currentPage, numPages, spread, setNumPages, setSpread, nextPage, prevPage } =
    useReader();
  const { doc, error } = usePdfDocument(samplePdf);
  const { theme, toggle: toggleTheme } = useTheme();
  const touchStartX = useRef<number | null>(null);

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
        <span className="font-semibold">Reading Stage</span>
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
            <PdfPage doc={doc} page={currentPage} />
            {rightPage && <PdfPage doc={doc} page={rightPage} />}
          </>
        )}
      </main>
      <footer className="border-t border-black/10 px-4 py-2 dark:border-white/10">
        <PositionIndicator />
      </footer>
    </div>
  );
}
