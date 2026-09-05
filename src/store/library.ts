import { create } from 'zustand';

// Which book is open, if any. `null` means the shelf is showing. Persisted so
// reopening the app returns you to the book you were reading — sense of place
// starts before the first page (SPEC §6).
const STORAGE_KEY = 'reading-stage:current-book';

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function persist(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode) — selection just won't survive reloads. */
  }
}

type LibraryState = {
  currentBookId: string | null;
  openBook: (id: string) => void;
  closeBook: () => void;
};

export const useLibrary = create<LibraryState>((set) => ({
  currentBookId: readStored(),
  openBook: (id) => {
    persist(id);
    set({ currentBookId: id });
  },
  closeBook: () => {
    persist(null);
    set({ currentBookId: null });
  },
}));
