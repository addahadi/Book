import { create } from 'zustand';

// Reader position is (currentPage, pageOffset): the page number plus how far
// down that page the *top* of the visible band sits, as a fraction in [0, 1).
// This is the durable, resize-stable position — band boundaries are derived
// from it and the live viewport, never stored. A future "zoom" reading mode
// reuses this same position state.
type ReaderState = {
  currentPage: number;
  numPages: number;
  // Fraction [0, 1): top of the visible band within the current page.
  pageOffset: number;
  // Band tops (fractions) for the *current* page, published by the render layer
  // after it measures the page at fit-width. Always begins with 0. Viewport-
  // dependent — recomputed on resize — so not part of the durable position.
  bandTops: number[];
  setNumPages: (n: number) => void;
  // The render layer reports the current page's band layout here. We reconcile
  // pageOffset against it: a page entered from the end (offset >= 1, the
  // sentinel set by prevPage) snaps to the last band; otherwise we snap to the
  // nearest band top so a resize keeps you in place.
  setBandTops: (tops: number[]) => void;
  // Restore a saved position (issue #07) when reopening a book: jump straight to
  // the persisted page and in-page offset. Band tops reset until the render layer
  // measures the page, which then snaps `pageOffset` to the nearest band top.
  restorePosition: (page: number, offset: number) => void;
  goToPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
};

// The index of the last band whose top is at or before `offset`.
function bandIndexOf(tops: number[], offset: number): number {
  let idx = 0;
  for (let i = 0; i < tops.length; i++) if (tops[i] <= offset + 1e-6) idx = i;
  return idx;
}

export const useReader = create<ReaderState>((set, get) => ({
  currentPage: 1,
  numPages: 0,
  pageOffset: 0,
  bandTops: [0],
  setNumPages: (n) => set({ numPages: n }),
  setBandTops: (tops) => {
    const safe = tops.length ? tops : [0];
    const { pageOffset } = get();
    // >= 1 is the "entered from the end" sentinel set by prevPage.
    const offset =
      pageOffset >= 1 ? safe[safe.length - 1] : safe[bandIndexOf(safe, pageOffset)];
    set({ bandTops: safe, pageOffset: offset });
  },
  restorePosition: (page, offset) => {
    const { numPages } = get();
    const clamped = Math.max(1, numPages ? Math.min(page, numPages) : page);
    set({ currentPage: clamped, pageOffset: offset, bandTops: [0] });
  },
  // Jumping to a page lands at its top. Resets the band layout until the render
  // layer measures the new page.
  goToPage: (page) => {
    const { numPages } = get();
    const clamped = Math.max(1, numPages ? Math.min(page, numPages) : page);
    set({ currentPage: clamped, pageOffset: 0, bandTops: [0] });
  },
  // Turning steps through the current page's bands, rolling over to the next /
  // previous page at the edges. Clamped at the first band of page 1 and the last
  // band of the last page.
  nextPage: () => {
    const { currentPage, numPages, pageOffset, bandTops } = get();
    const i = bandIndexOf(bandTops, pageOffset);
    if (i < bandTops.length - 1) {
      set({ pageOffset: bandTops[i + 1] });
    } else if (currentPage < numPages) {
      set({ currentPage: currentPage + 1, pageOffset: 0, bandTops: [0] });
    }
  },
  prevPage: () => {
    const { currentPage, pageOffset, bandTops } = get();
    const i = bandIndexOf(bandTops, pageOffset);
    if (i > 0) {
      set({ pageOffset: bandTops[i - 1] });
    } else if (currentPage > 1) {
      // Enter the previous page at its end; setBandTops snaps to its last band
      // once that page has been measured (pageOffset >= 1 is the sentinel).
      set({ currentPage: currentPage - 1, pageOffset: 1, bandTops: [0] });
    }
  },
}));
