import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PdfPage, { type LineBox, type Selection } from './PdfPage';
import PositionIndicator from './PositionIndicator';
import SelectionMenu from './SelectionMenu';
import NoteEditor from './NoteEditor';
import BookmarkControls from './BookmarkControls';
import NotebookPanel from './NotebookPanel';
import TocPanel from './TocPanel';
import SearchPanel from './SearchPanel';
import { usePdfDocument } from './usePdfDocument';
import { useOutline } from './useOutline';
import { useBookSearch } from './search';
import { useChromeFade } from './useChromeFade';
import { usePageCache } from './prefetch';
import {
  estimateTextColumn,
  getBook,
  reconcileTextLayer,
  saveBookPosition,
  type TextColumn,
} from '../db/library';
import {
  addAnnotation,
  listAnnotations,
  removeAnnotation,
  updateAnnotation,
} from '../db/annotations';
import { UNDERLINE_COLOR, STRIKE_COLOR, HIGHLIGHT_COLORS } from './marks';
import { useLibrary } from '../store/library';
import { useReader } from '../store/reader';
import { useTheme } from '../store/theme';
import type { Annotation, AnnotationType, RegionRect, TextAnchor } from '../types';

// The note editor's target: a brand-new note over a just-selected run (not yet
// persisted — a draft), or an existing annotation being edited. Keeping a new
// note as a draft until it has content means an empty, abandoned note never
// leaves a phantom mark behind (and survives StrictMode's mount/unmount cycle).
type NoteTarget =
  | { mode: 'new'; anchor: TextAnchor; rect: DOMRect }
  | { mode: 'existing'; id: string; rect: DOMRect };

// Distance (px) a touch must travel horizontally to count as a page-turn swipe.
const SWIPE_THRESHOLD = 50;
// Farthest a pointer may move and still count as a tap (not a drag), for
// edge-tap page turns.
const TAP_MOVE = 10;
// Width of the left / right edge-tap zones, as a fraction of the surface — a tap
// here turns the page (SPEC §6.1: "click/tap page edges"). The middle is inert.
const EDGE_ZONE = 0.22;
// Widest a single page column is drawn, even on large screens, so text keeps a
// comfortable measure instead of ballooning; the page centres in extra space.
const MAX_PAGE_WIDTH = 1000;
// Horizontal breathing room around the page column, in px (total of both sides).
const H_GUTTER = 32;
// Only crop the page's blank side margins below this viewport width (px). It's a
// narrow-screen readability fix; on a roomy desktop the whole page (margins and
// all) reads like a book and text is already legible, so leave it be.
const CROP_MAX_WIDTH = 760;
// Geometric fallback step, as a fraction of viewport height: the slide used when
// line-packing can't advance (a scanned page with no line boxes, or a line /
// figure gap taller than the viewport). The 1 − 0.12 keeps a 12% strip repeating
// on those fallback steps so the seam line isn't lost — the same feel scanned
// pages had before #20. Line-aware bands overlap by exactly one line instead.
const BAND_OVERLAP = 0.12;

// The index of the last band whose top is at or before `offset`.
function bandIndexOf(tops: number[], offset: number): number {
  let idx = 0;
  for (let i = 0; i < tops.length; i++) if (tops[i] <= offset + 1e-6) idx = i;
  return idx;
}

// Pack a page into bands whose seams fall on line boundaries (issue #20).
//
// Returns the band tops as page-height fractions (always starting with 0).
// Greedy: each band holds as many *whole* lines as fit the viewport height
// `vh`; the next band begins at the last line it showed, so exactly one line
// repeats across the turn as a continuity handhold. The final band flushes the
// last line of text to the viewport bottom (leftover blank above, page bottom
// margin cropped) rather than leaving trailing whitespace.
//
// Safety net: when line-packing can't advance — no line boxes at all (scanned
// page), or the next chunk (a tall line, or a figure gap with no line to break
// at) exceeds the viewport — that one step falls back to a blind geometric
// slide. A band is therefore never empty and never overflows.
function computeBandTops(lines: LineBox[], pageHeight: number, vh: number): number[] {
  const H = pageHeight;
  if (!H || !vh || H <= vh) return [0];
  const n = lines.length;
  // Bottom of the last line of text (the whole page when there are no lines).
  const lastBottom = n ? lines[n - 1].bottom : H;
  // Top that flushes that last line against the viewport bottom.
  const flushTop = Math.max(0, lastBottom - vh);
  const step = Math.max(1, vh * (1 - BAND_OVERLAP)); // geometric fallback slide
  const EPS = 0.5;

  const tops = [0];
  let cur = 0; // top of the band just added, in px
  // `cur + vh < lastBottom` means the current band doesn't yet reach the last
  // line, so another band is needed. The guard is belt-and-braces against a
  // pathological page — progress is already guaranteed by the step fallback.
  for (let guard = 0; cur + vh < lastBottom - EPS && guard < 5000; guard++) {
    // Index of the last whole line fully visible from `cur`.
    let k = -1;
    for (let i = 0; i < n; i++) {
      if (lines[i].top >= cur - EPS && lines[i].bottom <= cur + vh + EPS) k = i;
    }
    // Next band repeats line k (one-line overlap); fall back to a geometric
    // slide when there's no whole line to show, or repeating wouldn't advance.
    let next = k === -1 ? cur + step : lines[k].top;
    if (next <= cur + EPS) next = cur + step;
    if (next >= flushTop - EPS) {
      tops.push(flushTop / H); // final band: flush the last line to the bottom
      break;
    }
    tops.push(next / H);
    cur = next;
  }
  return tops;
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
    setPageOffset,
    nextPage,
    prevPage,
    goToPage,
    restorePosition,
  } = useReader();
  const { theme, toggle: toggleTheme } = useTheme();

  const [data, setData] = useState<Uint8Array | null>(null);
  const [title, setTitle] = useState('');
  // Whether this book has a usable text layer (issue #12). A scanned, image-only
  // PDF has none, so text-run marks are off and the page takes region boxes
  // instead. Defaults true so a born-digital book is never wrongly degraded.
  const [hasTextLayer, setHasTextLayer] = useState(true);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 }); // the clipped reading viewport
  const [pageHeight, setPageHeight] = useState(0); // rendered page CSS height
  // The book's text-column extent (page-width fractions), estimated once per
  // document, used to crop blank side margins on a narrow screen. Null until
  // measured, or when there's nothing worth cropping (scanned/empty book).
  const [textColumn, setTextColumn] = useState<TextColumn | null>(null);
  const [lines, setLines] = useState<LineBox[]>([]); // page line boxes (#20)
  // True once this book's saved position has been restored. Gates the persist
  // effect so we never write the pre-restore default back over the saved spot.
  const [resumed, setResumed] = useState(false);
  const clipRef = useRef<HTMLDivElement>(null);
  // Start of an in-flight one-finger touch: position + time, so touchend can tell
  // a page-turn swipe from a text-selection drag, a vertical drag, or a slow
  // long-press. Null while no single-finger gesture is tracked (e.g. multitouch).
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  // Pointer-down position on the reading surface, to measure tap-vs-drag for
  // edge-tap turns. And a per-gesture latch set when a mark/selection tap opened
  // its own menu this cycle, so the same tap doesn't also turn the page.
  const surfaceDown = useRef<{ x: number; y: number } | null>(null);
  const actedRef = useRef(false);
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
  // Every bookmark in the book (issue #11), in page order, for the jump list.
  const bookmarks = useMemo(
    () => annotations.filter((a) => a.type === 'bookmark').sort((a, b) => a.page - b.page),
    [annotations],
  );

  // Bookmark the current page: a page-level mark (no in-page anchor), default
  // colour, unnamed. No-op if this page is already bookmarked.
  const addBookmark = useCallback(() => {
    if (annotationsRef.current.some((a) => a.type === 'bookmark' && a.page === currentPage)) return;
    const mark: Annotation = {
      id: crypto.randomUUID(),
      bookId,
      type: 'bookmark',
      page: currentPage,
      color: HIGHLIGHT_COLORS[0].value,
      createdAt: Date.now(),
      tags: [],
      links: [],
    };
    addAnnotation(mark).catch(() => {});
    setAnnotations((prev) => [...prev, mark]);
  }, [bookId, currentPage]);

  const updateBookmark = useCallback((id: string, changes: { label?: string; color?: string }) => {
    updateAnnotation(id, changes).catch(() => {});
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...changes } : a)));
  }, []);

  const removeBookmark = useCallback((id: string) => {
    removeAnnotation(id).catch(() => {});
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // A live selection awaiting a mark choice, and an existing mark awaiting a
  // remove confirmation — the two floating menus. Both carry the on-screen rect
  // they anchor to.
  const [pendingSel, setPendingSel] = useState<Selection | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{ id: string; rect: DOMRect } | null>(null);
  // The margin note open in the editor (issue #10), if any.
  const [editingNote, setEditingNote] = useState<NoteTarget | null>(null);
  // Whether the Notebook panel (issue #13) — the book-wide list of every mark —
  // is open.
  const [notebookOpen, setNotebookOpen] = useState(false);
  // Whether the Contents panel (issue #15) — the PDF's embedded outline — is open.
  const [tocOpen, setTocOpen] = useState(false);
  // Whether the full-text Search panel (issue #16) is open.
  const [searchOpen, setSearchOpen] = useState(false);
  // A jumped-to search match: the page it's on and the run to flash-highlight
  // there. Cleared once you turn away from that page. `hitFrac` carries the
  // match's vertical position (page-height fraction) once the page resolves it,
  // so we can land on the band that holds it.
  const [searchHit, setSearchHit] = useState<{ page: number; anchor: TextAnchor } | null>(null);
  const [hitFrac, setHitFrac] = useState<number | null>(null);
  const hitAppliedRef = useRef(false);
  // Focus Mode (issue #18): fullscreen, panels collapsed, margins dimmed. And
  // whether the pointer is resting on the chrome, which pins it visible.
  const [focusMode, setFocusMode] = useState(false);
  const [chromeHover, setChromeHover] = useState(false);
  // A manual hide (issue #18) that folds both toolbars away on demand,
  // overriding the auto-fade — for when the reader wants the chrome gone now
  // rather than after the idle timer. The restore chevron brings it back.
  const [chromeHidden, setChromeHidden] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const onSelect = useCallback((selection: Selection | null) => {
    if (selection) actedRef.current = true; // a real selection — not an edge tap
    setPendingRemove(null);
    setEditingNote(null);
    setPendingSel(selection);
  }, []);

  const onMarkClick = useCallback((id: string, rect: DOMRect) => {
    actedRef.current = true; // opened the remove menu — don't also turn the page
    setPendingSel(null);
    setEditingNote(null);
    setPendingRemove({ id, rect });
  }, []);

  // A margin note flag (or an existing mark's "Note") was tapped → edit it.
  const onNoteClick = useCallback((id: string, rect: DOMRect) => {
    actedRef.current = true;
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
          a.anchor?.kind === 'text' &&
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

  // Persist a region-box highlight drawn over a scanned page (issue #12): a
  // page-anchored box in normalized coords, default highlight colour. No text
  // run is involved, so it stores a `RegionRect` anchor rather than a TextAnchor.
  const createRegion = useCallback(
    (rect: RegionRect) => {
      const mark: Annotation = {
        id: crypto.randomUUID(),
        bookId,
        type: 'region',
        page: currentPage,
        anchor: rect,
        color: HIGHLIGHT_COLORS[0].value,
        createdAt: Date.now(),
        tags: [],
        links: [],
      };
      addAnnotation(mark).catch(() => {});
      setAnnotations((prev) => [...prev, mark]);
    },
    [bookId, currentPage],
  );

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

  // Land on the band holding a jumped-to search match (issue #16) once the page's
  // bands are measured. Runs when the match's vertical fraction arrives or the
  // band layout updates; a latch applies it once so ordinary turning afterward is
  // never fought. `hitFrac` is only ever set after the target page's bands exist,
  // so this can't prematurely snap to a stale single-band layout.
  useEffect(() => {
    if (hitFrac == null || hitAppliedRef.current) return;
    setPageOffset(bandTops[bandIndexOf(bandTops, hitFrac)] ?? 0);
    hitAppliedRef.current = true;
  }, [hitFrac, bandTops, setPageOffset]);

  // Clear the flash-highlight once you leave its page (turning within the page
  // keeps it). Guarded on the page so the band-landing offset change doesn't drop
  // it.
  useEffect(() => {
    if (searchHit && currentPage !== searchHit.page) {
      setSearchHit(null);
      setHitFrac(null);
    }
  }, [currentPage, searchHit]);

  // Load this book's bytes and restore its saved position (issue #07) so every
  // book reopens exactly where you left off; a never-opened book resumes at
  // page 1 / offset 0. Falls back to the shelf if the book was removed out from
  // under us.
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setTitle('');
    setHasTextLayer(true);
    setNoticeDismissed(false);
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
        setHasTextLayer(book.hasTextLayer !== false);
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

  // The PDF's embedded table of contents (issue #15), resolved once per document.
  const outline = useOutline(doc);

  // Whole-book full-text search (issue #16), indexed progressively per document.
  const bookSearch = useBookSearch(doc);

  // Jump to a search result: reveal its page, remember the run to flash-highlight,
  // and reset the band-landing latch so the new hit's band is applied once known.
  const jumpToSearchResult = useCallback(
    (page: number, anchor: TextAnchor) => {
      setSearchOpen(false);
      setSearchHit({ page, anchor });
      setHitFrac(null);
      hitAppliedRef.current = false;
      // Only reset the page position when actually changing pages — re-navigating
      // to the current page would needlessly drop its measured bands.
      if (page !== posRef.current.currentPage) goToPage(page);
    },
    [goToPage],
  );

  // The page reports where the match sits vertically once it has rendered and
  // resolved the run; stash it for the band-landing effect below.
  const onSearchHit = useCallback((frac: number | null) => {
    if (frac != null) setHitFrac(frac);
  }, []);

  // Auto-fading chrome (issue #18). Pin it visible while any panel/menu is open
  // or the pointer rests on the toolbars, so it never fades from under a control.
  const chromeLocked =
    tocOpen ||
    searchOpen ||
    notebookOpen ||
    chromeHover ||
    !!pendingSel ||
    !!pendingRemove ||
    !!editingNote;
  const { visible: autoChromeVisible, poke: pokeChrome } = useChromeFade(chromeLocked);
  // A manual hide wins over everything (and over the auto-fade). Once folded
  // away, ordinary interaction won't summon the chrome back — only the restore
  // chevron does — so an immersive hide actually stays hidden.
  const chromeVisible = chromeHidden ? false : autoChromeVisible;
  const restoreChrome = useCallback(() => {
    setChromeHidden(false);
    pokeChrome();
  }, [pokeChrome]);

  // Focus Mode (issue #18): one gesture into fullscreen with panels collapsed and
  // margins dimmed. Fullscreen may be refused (permissions, an unsupported
  // context) — dim and collapse regardless, so the mode still means something.
  const enterFocus = useCallback(() => {
    setTocOpen(false);
    setSearchOpen(false);
    setNotebookOpen(false);
    rootRef.current?.requestFullscreen?.().catch(() => {});
    setFocusMode(true);
  }, []);

  const exitFocus = useCallback(() => {
    setFocusMode(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  // Exiting fullscreen by any means (the browser's own Esc, F11) leaves Focus
  // Mode too, keeping the toggle and the dimmed surface in step with reality.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFocusMode(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Esc exits Focus Mode. A fallback for when fullscreen wasn't granted (there's
  // no fullscreenchange to catch then); guarded on no open panel so a panel's own
  // Esc still closes it first.
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !tocOpen && !searchOpen && !notebookOpen) exitFocus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusMode, tocOpen, searchOpen, notebookOpen, exitFocus]);

  // Shared page-raster cache (issue #22): PdfPage blits the visible canvas from
  // it, and we warm the neighbours below so a page turn is instant and never
  // flashes blank.
  const cache = usePageCache(doc);

  // Publish the loaded document's page count to the store.
  useEffect(() => {
    if (doc) setNumPages(doc.numPages);
  }, [doc, setNumPages]);

  // Self-heal a book wrongly flagged as scanned (issue #12). Page-1-only
  // detection misreads a born-digital book behind an image cover (e.g. DDIA,
  // whose text starts on page 3) as having no text layer, which would block
  // selection. Once the doc is open, re-check across its early pages and, if it
  // really has text, flip region mode off and correct the stored flag.
  useEffect(() => {
    if (!doc || hasTextLayer) return; // only a book currently treated as scanned
    let cancelled = false;
    reconcileTextLayer(bookId, doc, false)
      .then((has) => {
        if (!cancelled && has) setHasTextLayer(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doc, hasTextLayer, bookId]);

  // Estimate the text-column extent once per document, so a narrow screen can
  // crop the blank side margins and enlarge text (which also re-engages banding).
  // Scanned books (no text layer) are left uncropped. Resets between books so a
  // stale column is never applied to the next one.
  useEffect(() => {
    setTextColumn(null);
    if (!doc || !hasTextLayer) return;
    let cancelled = false;
    estimateTextColumn(doc)
      .then((c) => !cancelled && setTextColumn(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doc, hasTextLayer]);

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

  // Fit the text column — not the whole sheet — to the screen on a narrow
  // viewport: render the page wider so the column fills the available width, and
  // translate to recentre it, letting the clip hide the blank margins. The
  // MAX_PAGE_WIDTH cap now bounds the *column* width (a comfortable measure);
  // renderWidth is derived from it and left unclamped. Guards skip the crop for a
  // near-full-width column (a wide figure page) or an implausibly narrow one.
  const availWidth = Math.min(Math.max(box.w - H_GUTTER, 0), MAX_PAGE_WIDTH);
  const columnW = textColumn ? textColumn.rightFrac - textColumn.leftFrac : 1;
  const cropActive =
    hasTextLayer &&
    box.w > 0 &&
    box.w < CROP_MAX_WIDTH &&
    !!textColumn &&
    columnW >= 0.2 &&
    columnW <= 0.9;
  const width = cropActive ? availWidth / columnW : availWidth;
  const cropTx = cropActive
    ? (0.5 - (textColumn!.leftFrac + textColumn!.rightFrac) / 2) * width
    : 0;

  // The render layer reports the page's height and its line boxes together once
  // drawn. Guard the height against sub-pixel jitter so we don't rerun the band
  // pass for nothing; lines come as a fresh array per render (page change).
  const onMeasure = useCallback((h: number, ls: LineBox[]) => {
    setPageHeight((prev) => (Math.abs(prev - h) < 0.5 ? prev : h));
    setLines(ls);
  }, []);

  // Recompute band tops whenever the page's lines, height, or the viewport
  // height changes (new page, resize). Bands break on line boundaries (#20);
  // the store reconciles the stored offset so you stay in place across a resize.
  useEffect(() => {
    if (!box.h || !pageHeight) return;
    setBandTops(computeBandTops(lines, pageHeight, box.h));
  }, [lines, pageHeight, box.h, setBandTops]);

  // How far to slide the page up to reveal the current band, clamped so the
  // last band sits flush against the page bottom.
  const maxShift = Math.max(0, pageHeight - box.h);
  const shift = Math.min(pageOffset * pageHeight, maxShift);

  // Turn animation, split by meaning (#20). A band turn *within* a page slides
  // (you watch the one-line overlap travel bottom→top). A turn to a *new* page
  // must not slide — the content swaps, so animating the transform would drag
  // the new page in from a stale offset. On the render where `currentPage` just
  // changed, `prevPageRef` still holds the old page, so `samePage` is false and
  // we render the jump with no transition; the layout effect then catches the
  // ref up before the next paint, re-enabling the slide for band turns.
  const prevPageRef = useRef(currentPage);
  const samePage = prevPageRef.current === currentPage;
  useLayoutEffect(() => {
    prevPageRef.current = currentPage;
  }, [currentPage]);

  const bi = bandIndexOf(bandTops, pageOffset);
  const atStart = currentPage <= 1 && bi === 0;
  const atEnd = numPages > 0 && currentPage >= numPages && bi === bandTops.length - 1;

  // Warm the neighbour a turn is about to reveal (issue #22), so the page swap
  // is instant. Prioritized by band position — the next page once you reach the
  // last band, the previous once you're at the first — and deferred a beat so it
  // never competes with the current page's own render.
  useEffect(() => {
    if (!doc || width <= 0) return;
    const atLastBand = bi >= bandTops.length - 1;
    const atFirstBand = bi <= 0;
    const t = window.setTimeout(() => {
      if (atLastBand && currentPage < numPages) cache.prefetch(currentPage + 1, width);
      if (atFirstBand && currentPage > 1) cache.prefetch(currentPage - 1, width);
    }, 150);
    return () => window.clearTimeout(t);
  }, [doc, width, currentPage, bi, bandTops.length, numPages, cache]);

  // ← / → keys turn pages/bands; PageUp/PageDown jump ±10 pages for coarse
  // travel (issue #21). Bound once; the store reads live state. The scrubber
  // slider handles these keys itself and stops propagation, so a focused slider
  // moves by page without also turning a band here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/⌘+F opens full-text search (issue #16). Native find can't reach the
      // book — only the current page's text layer is in the DOM — so take the key.
      // Handled before the typing guard so it works from anywhere, including the
      // search box itself.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      // Don't hijack keys while typing in a field (e.g. go-to-page).
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))
        return;
      if (e.key === 'ArrowRight') nextPage();
      else if (e.key === 'ArrowLeft') prevPage();
      else if (e.key === 'PageDown') {
        e.preventDefault();
        goToPage(posRef.current.currentPage + 10);
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        goToPage(posRef.current.currentPage - 10);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextPage, prevPage, goToPage]);

  // Remember where a surface press began (tap-vs-drag) and clear the per-gesture
  // "already acted" latch. A mark/note tap that runs before this pointerup (the
  // text layer's own handler) sets the latch to suppress the edge-tap turn.
  const onSurfacePointerDown = (e: React.PointerEvent) => {
    surfaceDown.current = { x: e.clientX, y: e.clientY };
    actedRef.current = false;
  };

  // A tap on the page turns it only at the left / right edges (SPEC §6.1); a tap
  // elsewhere just dismisses an open menu. Never acts when a selection just
  // completed (that pointerup opens the mark menu) or when a mark tap already
  // opened its own menu this cycle.
  const onSurfacePointerUp = (e: React.PointerEvent) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().length > 0) return;
    const down = surfaceDown.current;
    surfaceDown.current = null;

    // An open menu: a tap anywhere dismisses it (and does nothing else).
    if (pendingSel || pendingRemove || editingNote) {
      setPendingSel(null);
      setPendingRemove(null);
      setEditingNote(null); // unmount → auto-saves the open note
      return;
    }
    if (actedRef.current) return; // a mark/note tap already handled this gesture

    // Edge-tap to turn: a still tap in the left / right margin zone.
    if (!down) return;
    if (Math.abs(e.clientX - down.x) > TAP_MOVE || Math.abs(e.clientY - down.y) > TAP_MOVE)
      return; // moved too far — a drag, not a tap
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = rect.width ? (e.clientX - rect.left) / rect.width : 0.5;
    if (frac <= EDGE_ZONE) prevPage();
    else if (frac >= 1 - EDGE_ZONE) nextPage();
  };

  // Swipe left/right on touch devices. Disambiguated from the other one-finger
  // gestures that share this surface: a text-selection drag (which must be left
  // to the mark menu, not eaten as a turn), a vertical drag, and a slow
  // long-press. A two-finger touch is never a swipe (reserved for pinch-zoom).
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length >= 2) {
      touchStart.current = null; // multitouch — not a swipe candidate
      return;
    }
    const t = e.touches[0];
    touchStart.current = t ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    // A completed selection isn't a swipe — leave the text under the mark menu.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().length > 0) return;
    const end = e.changedTouches[0];
    if (!end) return;
    const dx = end.clientX - start.x;
    const dy = end.clientY - start.y;
    // Must be far enough, predominantly horizontal, and quick — so a vertical
    // drag or a slow long-press-and-drag (selection) never turns the page.
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
    if (Date.now() - start.t > 800) return;
    // Swipe right-to-left (dx < 0) advances, like turning a page forward.
    if (dx < 0) nextPage();
    else prevPage();
  };

  return (
    <div
      ref={rootRef}
      className="flex h-full flex-col bg-neutral-100 text-neutral-900 dark:bg-stone-900 dark:text-stone-100"
    >
      {/* Hidden bars are unmounted (not just faded) so `main` reclaims their
          height — a full-bleed reading surface. Only the manual hide collapses
          the layout; the idle auto-fade stays opacity-only so the page never
          shifts under you while you're reading. */}
      {!chromeHidden && (
      <header
        onPointerEnter={() => setChromeHover(true)}
        onPointerLeave={() => setChromeHover(false)}
        className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-black/10 px-3 py-2 text-sm transition-opacity duration-500 dark:border-white/10 sm:px-4 ${
          chromeVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-3">
          <button
            type="button"
            onClick={closeBook}
            aria-label="Back to library"
            title="Back to library"
            className="shrink-0 rounded px-2 py-1 ring-1 ring-black/10 hover:bg-black/5 dark:ring-white/10 dark:hover:bg-white/5"
          >
            <span aria-hidden>←</span>
            <span className="hidden sm:inline"> Library</span>
          </button>
          <button
            type="button"
            onClick={() => setTocOpen((o) => !o)}
            aria-pressed={tocOpen}
            aria-label="Contents"
            title="Contents — the book's table of contents"
            className="shrink-0 rounded px-2 py-1 ring-1 ring-black/10 hover:bg-black/5 dark:ring-white/10 dark:hover:bg-white/5"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="block">
              <path
                d="M2 3h3M2 8h3M2 13h3M7 3h7M7 8h7M7 13h7"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen((o) => !o)}
            aria-pressed={searchOpen}
            aria-label="Search"
            title="Search this book (Ctrl/⌘+F)"
            className="shrink-0 rounded px-2 py-1 ring-1 ring-black/10 hover:bg-black/5 dark:ring-white/10 dark:hover:bg-white/5"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="block">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <span className="truncate font-semibold" title={title}>
            {title}
          </span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3">
          <button
            type="button"
            onClick={() => setChromeHidden(true)}
            aria-label="Hide toolbars"
            title="Hide toolbars — fold the top and bottom bars away"
            className="rounded px-2 py-1 ring-1 ring-black/10 hover:bg-black/5 dark:ring-white/10 dark:hover:bg-white/5"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="block">
              <rect
                x="3.5"
                y="7"
                width="9"
                height="6.5"
                rx="1.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <path
                d="M5.5 7V5a2.5 2.5 0 0 1 5 0"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={focusMode ? exitFocus : enterFocus}
            aria-pressed={focusMode}
            aria-label={focusMode ? 'Exit focus mode' : 'Enter focus mode'}
            title={focusMode ? 'Exit focus mode (Esc)' : 'Focus mode — fullscreen, distraction-free'}
            className="rounded px-2 py-1 ring-1 ring-black/10 hover:bg-black/5 dark:ring-white/10 dark:hover:bg-white/5"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="block">
              {focusMode ? (
                <path
                  d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : (
                <path
                  d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          </button>
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
          <BookmarkControls
            bookmarks={bookmarks}
            currentPage={currentPage}
            onAdd={addBookmark}
            onUpdate={updateBookmark}
            onRemove={removeBookmark}
            onJump={goToPage}
          />
          <button
            type="button"
            onClick={() => setNotebookOpen((o) => !o)}
            aria-pressed={notebookOpen}
            aria-label="Notebook"
            title="Notebook — all highlights, notes & bookmarks"
            className="flex items-center gap-1 rounded px-2 py-1 ring-1 ring-black/10 hover:bg-black/5 dark:ring-white/10 dark:hover:bg-white/5"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="block">
              <path
                d="M4 2h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
              <path d="M3 5.5h1.5M3 8h1.5M3 10.5h1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            {annotations.length > 0 && (
              <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                {annotations.length}
              </span>
            )}
          </button>
          <span className="hidden tabular-nums text-neutral-500 dark:text-neutral-400 sm:inline">
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
      )}
      {!hasTextLayer && !noticeDismissed && (
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-950/40 dark:text-amber-200">
          <span aria-hidden>⚠</span>
          <span className="min-w-0 flex-1">
            This book has no text layer — it looks scanned. You can bookmark pages and drag to
            draw region highlights over the page image, but text can't be selected or searched.
          </span>
          <button
            type="button"
            onClick={() => setNoticeDismissed(true)}
            aria-label="Dismiss notice"
            className="shrink-0 rounded px-2 py-0.5 ring-1 ring-amber-500/30 hover:bg-amber-500/10 dark:ring-amber-400/20"
          >
            Got it
          </button>
        </div>
      )}
      {/* Subtle nudge to restore faded chrome (issue #18). Any interaction also
          brings it back; this just tells you the toolbar is a gesture away. */}
      {!chromeVisible && (
        <button
          type="button"
          onClick={restoreChrome}
          aria-label="Show toolbar"
          className="fixed left-1/2 top-1.5 z-30 flex -translate-x-1/2 items-center justify-center rounded-full px-3 py-0.5 text-neutral-500 opacity-30 transition-opacity hover:opacity-90 dark:text-neutral-400"
        >
          <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden className="block">
            <path d="M2 3l7 4 7-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <main
        onPointerDown={onSurfacePointerDown}
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
              className={
                samePage
                  ? 'ease-out motion-safe:transition-transform motion-safe:duration-200'
                  : 'ease-out'
              }
              style={{ width, transform: `translateX(${cropTx}px) translateY(${-shift}px)` }}
            >
              <PdfPage
                doc={doc}
                page={currentPage}
                width={width}
                cache={cache}
                annotations={pageAnnotations}
                regionMode={!hasTextLayer}
                searchHit={searchHit && searchHit.page === currentPage ? searchHit.anchor : null}
                onSearchHit={onSearchHit}
                onMeasure={onMeasure}
                onSelect={onSelect}
                onMarkClick={onMarkClick}
                onNoteClick={onNoteClick}
                onRegionDraw={createRegion}
              />
            </div>
          </div>
        )}
        {/* Focus Mode margin dimming (issue #18): a vignette that darkens the
            gutters around the centred page while leaving the page itself clear.
            Click-through, so selection and turning still work underneath. */}
        <div className={`focusVignette ${focusMode ? 'opacity-100' : 'opacity-0'}`} aria-hidden />
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
          // A region box (scanned page) has no text run to note against, so its
          // remove menu is Remove-only; text marks keep the Note action.
          onNote={
            annotations.find((a) => a.id === pendingRemove.id)?.type === 'region'
              ? undefined
              : () => onNoteClick(pendingRemove.id, pendingRemove.rect)
          }
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
      {tocOpen && (
        <TocPanel
          outline={outline}
          bookmarks={bookmarks}
          currentPage={currentPage}
          onJump={(page) => {
            goToPage(page);
            setTocOpen(false);
          }}
          onClose={() => setTocOpen(false)}
        />
      )}
      {searchOpen && (
        <SearchPanel
          book={bookSearch}
          currentPage={currentPage}
          onJump={jumpToSearchResult}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {notebookOpen && (
        <NotebookPanel
          annotations={annotations}
          bookTitle={title}
          currentPage={currentPage}
          onJump={(page) => {
            goToPage(page);
            setNotebookOpen(false);
          }}
          onClose={() => setNotebookOpen(false)}
        />
      )}
      {!chromeHidden && (
      <footer
        onPointerEnter={() => setChromeHover(true)}
        onPointerLeave={() => setChromeHover(false)}
        className={`border-t border-black/10 px-4 py-2 transition-opacity duration-500 dark:border-white/10 ${
          chromeVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <PositionIndicator doc={doc} />
      </footer>
      )}
    </div>
  );
}
