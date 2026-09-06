import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PdfPage, { type Selection } from './PdfPage';
import PositionIndicator from './PositionIndicator';
import SelectionMenu from './SelectionMenu';
import NoteEditor from './NoteEditor';
import { usePdfDocument } from './usePdfDocument';
import { getBook, saveBookPosition } from '../db/library';
import {
  addAnnotation,
  listAnnotations,
  removeAnnotation,
  updateAnnotation,
} from '../db/annotations';
import { UNDERLINE_COLOR, STRIKE_COLOR } from './marks';
import { useLibrary } from '../store/library';
import { useReader } from '../store/reader';
import { useTheme } from '../store/theme';
import type { Annotation, AnnotationType, TextAnchor } from '../types';

// The note editor's target: a brand-new note over a just-selected run (not yet
// persisted — a draft), or an existing annotation being edited. Keeping a new
// note as a draft until it has content means an empty, abandoned note never
// leaves a phantom mark behind (and survives StrictMode's mount/unmount cycle).
type NoteTarget =
  | { mode: 'new'; anchor: TextAnchor; rect: DOMRect }
  | { mode: 'existing'; id: string; rect: DOMRect };

// Distance (px) a touch must travel horizontally to count as a page-turn swipe.
const SWIPE_THRESHOLD = 50;
// Widest a single page column is drawn, even on large screens, so text keeps a
// comfortable measure instead of ballooning; the page centres in extra space.
const MAX_PAGE_WIDTH = 1000;
// Horizontal breathing room around the page column, in px (total of both sides).
const H_GUTTER = 32;
// Overlap between consecutive bands, as a fraction of the viewport height — a
// strip of lines repeats across a turn so you don't lose the line at the seam.
const BAND_OVERLAP = 0.12;

// The index of the last band whose top is at or before `offset`.
function bandIndexOf(tops: number[], offset: number): number {
  let idx = 0;
  for (let i = 0; i < tops.length; i++) if (tops[i] <= offset + 1e-6) idx = i;
  return idx;
}

// The paginated reader for one open book. A page is fit to the viewport width;
// a page taller than the viewport is read in bands, one screen-height slice per
// turn (see issue #06b). Bytes come from IndexedDB; the shelf (App) decides
// which book is open.
export default function Reader({ bookId }: { bookId: string }) {
  const closeBook = useLibrary((s) => s.closeBook);
  const {
    currentPage,
    numPages,
    pageOffset,
    bandTops,
    setNumPages,
    setBandTops,
    nextPage,
    prevPage,
    restorePosition,
  } = useReader();
  const { theme, toggle: toggleTheme } = useTheme();

  const [data, setData] = useState<Uint8Array | null>(null);
  const [title, setTitle] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 }); // the clipped reading viewport
  const [pageHeight, setPageHeight] = useState(0); // rendered page CSS height
  // True once this book's saved position has been restored. Gates the persist
  // effect so we never write the pre-restore default back over the saved spot.
  const [resumed, setResumed] = useState(false);
  const clipRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  // Latest position + resume flag, mirrored into refs so the leave-book flush
  // can read them without re-subscribing on every turn.
  const posRef = useRef({ currentPage, pageOffset, resumed });
  posRef.current = { currentPage, pageOffset, resumed };

  // The annotation sidecar for this book (issue #09), loaded from IndexedDB on
  // open and kept in memory. Marks for the current page are painted by PdfPage;
  // the PDF bytes are never touched.
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  useEffect(() => {
    let cancelled = false;
    setAnnotations([]);
    listAnnotations(bookId).then((a) => !cancelled && setAnnotations(a));
    return () => {
      cancelled = true;
    };
  }, [bookId]);
  const pageAnnotations = useMemo(
    () => annotations.filter((a) => a.page === currentPage),
    [annotations, currentPage],
  );
  // Latest annotations mirrored into a ref so the note-editor's commit-on-close
  // (which fires from an unmount cleanup) can read them without re-subscribing.
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  // A live selection awaiting a mark choice, and an existing mark awaiting a
  // remove confirmation — the two floating menus. Both carry the on-screen rect
  // they anchor to.
  const [pendingSel, setPendingSel] = useState<Selection | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{ id: string; rect: DOMRect } | null>(null);
  // The margin note open in the editor (issue #10), if any.
  const [editingNote, setEditingNote] = useState<NoteTarget | null>(null);

  const onSelect = useCallback((selection: Selection | null) => {
    setPendingRemove(null);
    setEditingNote(null);
    setPendingSel(selection);
  }, []);

  const onMarkClick = useCallback((id: string, rect: DOMRect) => {
    setPendingSel(null);
    setEditingNote(null);
    setPendingRemove({ id, rect });
  }, []);

  // A margin note flag (or an existing mark's "Note") was tapped → edit it.
  const onNoteClick = useCallback((id: string, rect: DOMRect) => {
    setPendingSel(null);
    setPendingRemove(null);
    setEditingNote({ mode: 'existing', id, rect });
  }, []);

  // Apply a mark to the pending selection: highlight in a colour, or underline /
  // strike through the same run via the shared anchoring engine. Re-marking the
  // exact same run toggles/replaces rather than stacking duplicates: same
  // type+range+colour removes it; a highlight of a different colour replaces it.
  const createMark = useCallback(
    (type: AnnotationType, color?: string) => {
      if (!pendingSel) return;
      const { anchor } = pendingSel;
      const existing = annotations.find(
        (a) =>
          a.page === currentPage &&
          a.type === type &&
          a.anchor.kind === 'text' &&
          a.anchor.startOffset === anchor.startOffset &&
          a.anchor.endOffset === anchor.endOffset,
      );

      const finish = () => {
        window.getSelection()?.removeAllRanges();
        setPendingSel(null);
      };

      if (existing) {
        // Same mark again (same colour, or a colourless underline/strike): toggle
        // it off. A highlight in a new colour: fall through to replace it.
        const sameColour = existing.color === color;
        if (sameColour) {
          removeAnnotation(existing.id).catch(() => {});
          setAnnotations((prev) => prev.filter((a) => a.id !== existing.id));
          finish();
          return;
        }
        removeAnnotation(existing.id).catch(() => {});
        setAnnotations((prev) => prev.filter((a) => a.id !== existing.id));
      }

      const mark: Annotation = {
        id: crypto.randomUUID(),
        bookId,
        type,
        page: currentPage,
        anchor,
        color,
        createdAt: Date.now(),
        tags: [],
        links: [],
      };
      addAnnotation(mark).catch(() => {});
      setAnnotations((prev) => [...prev, mark]);
      finish();
    },
    [pendingSel, annotations, bookId, currentPage],
  );

  const removeMark = useCallback((id: string) => {
    removeAnnotation(id).catch(() => {});
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    setPendingRemove(null);
  }, []);

  // Start a fresh margin note over the pending selection. Nothing is persisted
  // yet — the editor opens on a draft carrying the run's anchor, and the `note`
  // annotation is created only if the user actually writes something.
  const addNoteToSelection = useCallback(() => {
    if (!pendingSel) return;
    const { anchor, rect } = pendingSel;
    window.getSelection()?.removeAllRanges();
    setPendingSel(null);
    setEditingNote({ mode: 'new', anchor, rect });
  }, [pendingSel]);

  // Commit the editor's body to the sidecar for a specific target. The target is
  // bound by the editor's render (not read from live state), so the unmount
  // auto-save still commits correctly even though a click-away has already
  // cleared `editingNote`. A new note is created only when non-empty; editing an
  // existing note updates it, or — when emptied — drops a standalone note /
  // strips the body off a highlight. Unchanged or empty-new bodies are no-ops,
  // so a StrictMode mount/unmount double-invoke can't create or delete anything
  // spuriously, and a duplicate create can't slip through.
  const commitNote = useCallback(
    (target: NoteTarget, body: string) => {
      const text = body.trim();

      if (target.mode === 'new') {
        if (!text) return;
        const mark: Annotation = {
          id: crypto.randomUUID(),
          bookId,
          type: 'note',
          page: currentPage,
          anchor: target.anchor,
          note: text,
          createdAt: Date.now(),
          tags: [],
          links: [],
        };
        addAnnotation(mark).catch(() => {});
        setAnnotations((prev) => [...prev, mark]);
        return;
      }

      const ann = annotationsRef.current.find((a) => a.id === target.id);
      if (!ann) return;
      if (!text) {
        if (ann.type === 'note') {
          removeAnnotation(target.id).catch(() => {});
          setAnnotations((prev) => prev.filter((a) => a.id !== target.id));
        } else if (ann.note) {
          updateAnnotation(target.id, { note: '' }).catch(() => {});
          setAnnotations((prev) => prev.map((a) => (a.id === target.id ? { ...a, note: '' } : a)));
        }
        return;
      }
      if (ann.note === text) return; // unchanged
      updateAnnotation(target.id, { note: text }).catch(() => {});
      setAnnotations((prev) => prev.map((a) => (a.id === target.id ? { ...a, note: text } : a)));
    },
    [bookId, currentPage],
  );

  // Delete from the editor: a draft simply closes; a standalone note is removed
  // outright; a note on a highlight is stripped but the highlight is kept.
  const deleteNote = useCallback((target: NoteTarget) => {
    if (target.mode === 'new') return;
    const ann = annotationsRef.current.find((a) => a.id === target.id);
    if (!ann) return;
    if (ann.type === 'note') {
      removeAnnotation(target.id).catch(() => {});
      setAnnotations((prev) => prev.filter((a) => a.id !== target.id));
    } else {
      updateAnnotation(target.id, { note: '' }).catch(() => {});
      setAnnotations((prev) => prev.map((a) => (a.id === target.id ? { ...a, note: '' } : a)));
    }
  }, []);

  // A turn (page or band) moves the text out from under the menus — dismiss them.
  // Clearing the note editor unmounts it, which auto-saves the open note.
  useEffect(() => {
    setPendingSel(null);
    setPendingRemove(null);
    setEditingNote(null);
  }, [currentPage, pageOffset]);

  // Load this book's bytes and restore its saved position (issue #07) so every
  // book reopens exactly where you left off; a never-opened book resumes at
  // page 1 / offset 0. Falls back to the shelf if the book was removed out from
  // under us.
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setTitle('');
    setLoadError(null);
    setNumPages(0);
    setResumed(false);
    restorePosition(1, 0);
    getBook(bookId)
      .then(async (book) => {
        if (cancelled) return;
        if (!book) {
          closeBook();
          return;
        }
        setTitle(book.title);
        restorePosition(book.lastPage ?? 1, book.lastPosition ?? 0);
        setResumed(true);
        const buf = await book.bytes.arrayBuffer();
        if (!cancelled) setData(new Uint8Array(buf));
      })
      .catch((e) => !cancelled && setLoadError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [bookId, closeBook, setNumPages, restorePosition]);

  const { doc, error: renderError } = usePdfDocument(data);
  const error = loadError ?? renderError;

  // Publish the loaded document's page count to the store.
  useEffect(() => {
    if (doc) setNumPages(doc.numPages);
  }, [doc, setNumPages]);

  // Persist the reading position for auto-resume (issue #07). Debounced so
  // band-by-band turning doesn't hammer IndexedDB, and gated on `resumed` so it
  // only writes after the saved position has been restored for this book.
  useEffect(() => {
    if (!resumed) return;
    const t = setTimeout(() => {
      saveBookPosition(bookId, currentPage, pageOffset).catch(() => {
        /* storage hiccup — position just won't update this tick. */
      });
    }, 400);
    return () => clearTimeout(t);
  }, [bookId, currentPage, pageOffset, resumed]);

  // Flush the final position when leaving this book (closing to the shelf,
  // switching books, or unmount) so a turn made within the debounce window
  // isn't lost before a reload.
  useEffect(() => {
    return () => {
      const { currentPage: p, pageOffset: o, resumed: r } = posRef.current;
      if (r) saveBookPosition(bookId, p, o).catch(() => {});
    };
  }, [bookId]);

  // Measure the clipped reading viewport (drives fit-width and band count).
  useEffect(() => {
    const el = clipRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const width = Math.min(Math.max(box.w - H_GUTTER, 0), MAX_PAGE_WIDTH);

  const onHeight = useCallback((h: number) => {
    setPageHeight((prev) => (Math.abs(prev - h) < 0.5 ? prev : h));
  }, []);

  // Recompute band tops whenever the page's rendered height or the viewport
  // height changes (new page, resize). The store reconciles the stored offset
  // so you stay in place across a resize.
  useEffect(() => {
    const vh = box.h;
    const H = pageHeight;
    if (!vh || !H) return;
    const overlap = vh * BAND_OVERLAP;
    const step = Math.max(1, vh - overlap);
    let tops: number[];
    if (H <= vh) {
      tops = [0]; // the whole page fits — a single band
    } else {
      const count = Math.ceil((H - vh) / step) + 1;
      tops = [];
      // Each band top is one step down, but the last clamps flush to the page
      // bottom so you never land on empty space below the text.
      for (let i = 0; i < count; i++) tops.push(Math.min(i * step, H - vh) / H);
    }
    setBandTops(tops);
  }, [pageHeight, box.h, currentPage, setBandTops]);

  // How far to slide the page up to reveal the current band, clamped so the
  // last band sits flush against the page bottom.
  const maxShift = Math.max(0, pageHeight - box.h);
  const shift = Math.min(pageOffset * pageHeight, maxShift);

  const bi = bandIndexOf(bandTops, pageOffset);
  const atStart = currentPage <= 1 && bi === 0;
  const atEnd = numPages > 0 && currentPage >= numPages && bi === bandTops.length - 1;

  // ← / → keys turn pages/bands. Bound once; the store reads live state.
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

  // Tapping the page does NOT turn it — pages turn via the arrow keys, the
  // header buttons, or a swipe. A tap on the surface only dismisses an open menu,
  // but never when a selection just completed (that pointer-up is what opens the
  // selection menu — a click-away collapses the selection first, so it dismisses).
  const onSurfacePointerUp = () => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().length > 0) return;
    if (pendingSel || pendingRemove || editingNote) {
      setPendingSel(null);
      setPendingRemove(null);
      setEditingNote(null); // unmount → auto-saves the open note
    }
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
            {numPages ? ` of ${numPages}` : ''}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={prevPage}
              disabled={atStart}
              aria-label="Turn back"
              className="rounded px-2 py-1 ring-1 ring-black/10 enabled:hover:bg-black/5 disabled:opacity-40 dark:ring-white/10 dark:enabled:hover:bg-white/5"
            >
              ←
            </button>
            <button
              type="button"
              onClick={nextPage}
              disabled={atEnd}
              aria-label="Turn forward"
              className="rounded px-2 py-1 ring-1 ring-black/10 enabled:hover:bg-black/5 disabled:opacity-40 dark:ring-white/10 dark:enabled:hover:bg-white/5"
            >
              →
            </button>
          </div>
        </div>
      </header>
      <main
        onPointerUp={onSurfacePointerUp}
        onContextMenu={(e) => e.preventDefault()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="relative flex-1 select-none overflow-hidden"
      >
        {error ? (
          <div className="flex h-full items-center justify-center p-6 text-sm text-red-600 dark:text-red-400">
            Failed to render PDF: {error}
          </div>
        ) : (
          // The clip is the viewport; the inner column is the fit-width page,
          // slid up by `shift` to show the current band.
          <div ref={clipRef} className="absolute inset-0 flex items-start justify-center overflow-hidden">
            <div
              className="ease-out motion-safe:transition-transform motion-safe:duration-300"
              style={{ width, transform: `translateY(${-shift}px)` }}
            >
              <PdfPage
                doc={doc}
                page={currentPage}
                width={width}
                annotations={pageAnnotations}
                onHeight={onHeight}
                onSelect={onSelect}
                onMarkClick={onMarkClick}
                onNoteClick={onNoteClick}
              />
            </div>
          </div>
        )}
      </main>
      {pendingSel && (
        <SelectionMenu
          rect={pendingSel.rect}
          onHighlight={(color) => createMark('highlight', color)}
          onUnderline={() => createMark('underline', UNDERLINE_COLOR)}
          onStrike={() => createMark('strike', STRIKE_COLOR)}
          onNote={addNoteToSelection}
        />
      )}
      {pendingRemove && (
        <SelectionMenu
          rect={pendingRemove.rect}
          onRemove={() => removeMark(pendingRemove.id)}
          onNote={() => onNoteClick(pendingRemove.id, pendingRemove.rect)}
        />
      )}
      {editingNote && (
        <NoteEditor
          key={editingNote.mode === 'existing' ? editingNote.id : 'new'}
          rect={editingNote.rect}
          initial={
            editingNote.mode === 'existing'
              ? (annotations.find((a) => a.id === editingNote.id)?.note ?? '')
              : ''
          }
          onCommit={(body) => commitNote(editingNote, body)}
          onDelete={() => deleteNote(editingNote)}
          onClose={() => setEditingNote(null)}
        />
      )}
      <footer className="border-t border-black/10 px-4 py-2 dark:border-white/10">
        <PositionIndicator />
      </footer>
    </div>
  );
}
