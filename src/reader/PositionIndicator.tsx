import { useState } from 'react';
import { useReader } from '../store/reader';

// A "felt" position sense (SPEC §6.1): two blocks of pages behind (left) and
// ahead (right) with the current spread as a bright sliver between them, a
// "page N of M · P% in" readout, and a go-to-page jump. Deliberately not a
// scroll bar — there is no draggable handle; the split *is* your position.
export default function PositionIndicator() {
  const currentPage = useReader((s) => s.currentPage);
  const numPages = useReader((s) => s.numPages);
  const spread = useReader((s) => s.spread);
  const goToPage = useReader((s) => s.goToPage);
  const [draft, setDraft] = useState('');

  // Nothing to show until a document has loaded.
  if (!numPages) return null;

  // Rightmost page currently visible (spread shows two, unless at the last page).
  const lastVisible = spread && currentPage < numPages ? currentPage + 1 : currentPage;
  const behind = currentPage - 1; // pages fully behind you
  const current = lastVisible - currentPage + 1; // the open spread (1 or 2)
  const ahead = numPages - lastVisible; // pages still ahead
  const percent = Math.round((lastVisible / numPages) * 100);

  const label =
    lastVisible > currentPage
      ? `Pages ${currentPage}–${lastVisible} of ${numPages}`
      : `Page ${currentPage} of ${numPages}`;

  const onJump = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number.parseInt(draft, 10);
    // Ignore empty / non-numeric; goToPage clamps out-of-range values.
    if (Number.isFinite(n)) goToPage(n);
    setDraft('');
    (e.currentTarget as HTMLFormElement).querySelector('input')?.blur();
  };

  return (
    <div className="flex items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
      {/* Two-hands indicator: read | here | ahead. */}
      <div
        className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
        role="img"
        aria-label={`${percent}% through the book`}
      >
        {/* read (grows) · here (bright sliver) · ahead (shrinks) */}
        <div style={{ flexGrow: behind }} className="bg-neutral-500 dark:bg-neutral-300" />
        <div
          style={{ flexGrow: current }}
          className="min-w-[4px] bg-neutral-900 dark:bg-white"
        />
        <div style={{ flexGrow: ahead }} className="bg-neutral-300 dark:bg-neutral-600" />
      </div>

      <span className="whitespace-nowrap tabular-nums">
        {label} · {percent}% in
      </span>

      <form onSubmit={onJump} className="flex items-center gap-1">
        <label htmlFor="goto" className="whitespace-nowrap">
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
