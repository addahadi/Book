import { create } from 'zustand';

// Minimal reader state for M0. Pagination, spread mode, night mode, etc.
// are layered on by later tickets.
type ReaderState = {
  currentPage: number;
  numPages: number;
  // Two-page spread on wide viewports, single page on narrow ones. The
  // viewport decides this (see App); the step below reads from it so a turn
  // advances by the right number of pages for the active layout.
  spread: boolean;
  setNumPages: (n: number) => void;
  setSpread: (spread: boolean) => void;
  goToPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
};

export const useReader = create<ReaderState>((set, get) => ({
  currentPage: 1,
  numPages: 0,
  spread: false,
  setNumPages: (n) => set({ numPages: n }),
  // Switching layout never moves the reader — currentPage is preserved.
  setSpread: (spread) => set({ spread }),
  goToPage: (page) => {
    const { numPages } = get();
    const clamped = Math.max(1, numPages ? Math.min(page, numPages) : page);
    set({ currentPage: clamped });
  },
  // Turning is clamped at the first and last page by goToPage. In spread mode
  // a turn moves two pages so each turn reveals the next facing pair.
  nextPage: () => {
    const { currentPage, spread, goToPage } = get();
    goToPage(currentPage + (spread ? 2 : 1));
  },
  prevPage: () => {
    const { currentPage, spread, goToPage } = get();
    goToPage(currentPage - (spread ? 2 : 1));
  },
}));
