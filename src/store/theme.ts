import { create } from 'zustand';

// Light vs. warm-dark reading theme. Persisted so the choice survives reloads.
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'reading-stage:theme';

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function initialTheme(): Theme {
  const stored = readStored();
  if (stored) return stored;
  // First visit: follow the OS preference.
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Reflect the theme onto <html> (Tailwind `darkMode: 'class'`) and persist it. */
export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable (private mode) — theme just won't persist. */
  }
}

const initial = initialTheme();
// Apply before first paint to avoid a flash of the wrong theme.
applyTheme(initial);

type ThemeState = {
  theme: Theme;
  toggle: () => void;
};

export const useTheme = create<ThemeState>((set) => ({
  theme: initial,
  toggle: () =>
    set((s) => {
      const theme = s.theme === 'dark' ? 'light' : 'dark';
      applyTheme(theme);
      return { theme };
    }),
}));
