import { useEffect, useRef, useState } from 'react';
import { useReader } from '../store/reader';
import type { PdfDocument } from './pdf';
import { useThumbnail } from './thumbnails';
import { setScrubbing } from './prefetch';

// The seek preview's frame width (CSS px). The image sets its own height once
// loaded; the placeholder holds a page-ish aspect so the popover doesn't jump.
const PREVIEW_W = 132;

// A "felt" position sense (SPEC §6.1) that doubles as a seek control (issue #21):
// a block of what's behind you (left) and what's ahead (right) with a bright
// sliver for where you are, a "Page N of M · P% in" readout, and a go-to-page
// jump. It is *not* a scroll bar — you always land on a discrete page — but you
// can grab it to travel: drag (or click) to seek, with a live thumbnail of the
// page under your finger, releasing to land there.
//
// Position is continuous within a page: as you turn through a tall page's bands
// the sliver and P% advance smoothly, not only at page breaks.
export default function PositionIndicator({ doc }: { doc: PdfDocument | null }) {
  const currentPage = useReader((s) => s.currentPage);
  const numPages = useReader((s) => s.numPages);
  const pageOffset = useReader((s) => s.pageOffset);
  const goToPage = useReader((s) => s.goToPage);
  const [draft, setDraft] = useState('');

  // The page the cursor is over during a seek (the "would-land" ghost), or null
  // when not seeking. Drives the preview and the ghost marker; the real position
  // ("here") doesn't move until release, so an abandoned seek keeps your place.
  const [scrubPage, setScrubPage] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const barRef = useRef<HTMLDivElement>(null);
  const thumb = useThumbnail(doc, scrubPage);

  // Cancel an in-progress seek with Escape — release your place, don't jump.
  useEffect(() => {
    if (scrubPage == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        draggingRef.current = false;
        setScrubbing(false);
        setScrubPage(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scrubPage]);

  // Never leave prefetch paused if we unmount mid-seek.
  useEffect(() => () => setScrubbing(false), []);

  // Nothing to show until a document has loaded.
  if (!numPages) return null;

  // Book maps page 1..M to fraction 0..1 (page 1 at the far left).
  const denom = Math.max(1, numPages - 1);
  const pos = currentPage - 1 + Math.min(pageOffset, 0.999);
  const behind = pos;
  const ahead = Math.max(0, numPages - pos);
  const here = Math.max(numPages * 0.02, 0.5); // a small, always-visible "here" sliver
  const percent = Math.round((pos / numPages) * 100);

  // The page under a client X on the track (1..M), clamped to the ends.
  const pageAtX = (clientX: number): number => {
    const el = barRef.current;
    if (!el) return currentPage;
    const r = el.getBoundingClientRect();
    const frac = r.width ? (clientX - r.left) / r.width : 0;
    const c = Math.min(1, Math.max(0, frac));
    return Math.min(numPages, Math.max(1, Math.round(c * denom) + 1));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setScrubbing(true); // pause page prefetch so the preview never stalls (#22)
    setScrubPage(pageAtX(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    setScrubPage(pageAtX(e.clientX));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setScrubbing(false);
    const target = pageAtX(e.clientX);
    setScrubPage(null);
    goToPage(target); // land at the top of the target page
  };

  // Focused-slider keys move by page; stop propagation so Reader's global arrows
  // don't *also* turn a band (see Reader's key handler).
  const onKeyDown = (e: React.KeyboardEvent) => {
    let target: number | null = null;
    switch (e.key) {
      case 'ArrowLeft':
        target = currentPage - 1;
        break;
      case 'ArrowRight':
        target = currentPage + 1;
        break;
      case 'PageUp':
        target = currentPage - 10;
        break;
      case 'PageDown':
        target = currentPage + 10;
        break;
      case 'Home':
        target = 1;
        break;
      case 'End':
        target = numPages;
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    goToPage(target); // goToPage clamps out-of-range
  };

  const onJump = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number.parseInt(draft, 10);
    // Ignore empty / non-numeric; goToPage clamps out-of-range values.
    if (Number.isFinite(n)) goToPage(n);
    setDraft('');
    (e.currentTarget as HTMLFormElement).querySelector('input')?.blur();
  };

  const ghostPct = scrubPage != null ? ((scrubPage - 1) / denom) * 100 : 0;
  const scrubPercent = scrubPage != null ? Math.round(((scrubPage - 1) / denom) * 100) : 0;

  return (
    <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 sm:gap-4">
      {/* Track wrapper — anchors the ghost marker and the seek preview, which sit
          outside the (clipped) rounded track so they aren't cut off. */}
      <div className="relative flex-1">
        <div
          ref={barRef}
          role="slider"
          tabIndex={0}
          aria-label="Reading position — drag to seek"
          aria-valuemin={1}
          aria-valuemax={numPages}
          aria-valuenow={scrubPage ?? currentPage}
          aria-valuetext={`Page ${scrubPage ?? currentPage} of ${numPages}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
          style={{ touchAction: 'none' }}
          className="flex h-3.5 cursor-pointer touch-none overflow-hidden rounded-full bg-neutral-200 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:h-2.5 dark:bg-neutral-700"
        >
          {/* read (grows) · here (bright sliver) · ahead (shrinks) */}
          <div style={{ flexGrow: behind }} className="bg-neutral-500 dark:bg-neutral-300" />
          <div style={{ flexGrow: here }} className="min-w-[4px] bg-neutral-900 dark:bg-white" />
          <div style={{ flexGrow: ahead }} className="bg-neutral-300 dark:bg-neutral-600" />
        </div>

        {/* Ghost marker: where a release would land. */}
        {scrubPage != null && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 h-2.5 w-0.5 -translate-x-1/2 rounded bg-blue-500"
            style={{ left: `${ghostPct}%` }}
          />
        )}

        {/* Seek preview: page number + % immediately, thumbnail when ready. */}
        {scrubPage != null && (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2"
            style={{ left: `${Math.min(92, Math.max(8, ghostPct))}%` }}
          >
            <div
              className="overflow-hidden rounded bg-white shadow-lg ring-1 ring-black/20 dark:bg-neutral-800 dark:ring-white/20"
              style={{ width: PREVIEW_W }}
            >
              {thumb ? (
                <img src={thumb} alt="" className="block w-full" />
              ) : (
                <div
                  className="animate-pulse bg-neutral-200 dark:bg-neutral-700"
                  style={{ width: PREVIEW_W, height: Math.round(PREVIEW_W * 1.3) }}
                />
              )}
            </div>
            <div className="mt-1 text-center tabular-nums text-neutral-600 dark:text-neutral-300">
              Page {scrubPage} · {scrubPercent}%
            </div>
          </div>
        )}
      </div>

      <span className="whitespace-nowrap tabular-nums">
        <span className="sm:hidden">
          {currentPage}/{numPages}
        </span>
        <span className="hidden sm:inline">
          Page {currentPage} of {numPages} · {percent}% in
        </span>
      </span>

      <form onSubmit={onJump} className="flex items-center gap-1">
        <label htmlFor="goto" className="hidden whitespace-nowrap sm:inline">
          Go to
        </label>
        <input
          id="goto"
          type="number"
          min={1}
          max={numPages}
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-16 rounded px-2 py-1 text-neutral-900 tabular-nums ring-1 ring-black/10 dark:bg-neutral-800 dark:text-neutral-100 dark:ring-white/10"
        />
      </form>
    </div>
  );
}
