import { create } from 'zustand';

// Minimal reader state for M0. Pagination, spread mode, night mode, etc.
// are layered on by later tickets.
type ReaderState = {
  currentPage: number;
  numPages: number;
  setNumPages: (n: number) => void;
  goToPage: (page: number) => void;
};

export const useReader = create<ReaderState>((set, get) => ({
  currentPage: 1,
  numPages: 0,
  setNumPages: (n) => set({ numPages: n }),
  goToPage: (page) => {
    const { numPages } = get();
    const clamped = Math.max(1, numPages ? Math.min(page, numPages) : page);
    set({ currentPage: clamped });
  },
}));
