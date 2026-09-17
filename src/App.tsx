import { useState } from 'react';
import Reader from './reader/Reader';
import Shelf from './library/Shelf';
import Landing from './Landing';
import { useLibrary } from './store/library';

// Remember, across reloads, that a visitor has seen the landing pitch — so the
// shelf is home for anyone who's been here before.
const SEEN_LANDING_KEY = 'reading-stage:seen-landing';

function hasSeenLanding(): boolean {
  try {
    return localStorage.getItem(SEEN_LANDING_KEY) === '1';
  } catch {
    return false; // storage unavailable (private mode) — just show the landing.
  }
}

// Three states: the landing pitch (first visit, no book), the shelf (no book
// open), or the reader (a book open). The library store remembers which book
// was open across reloads.
export default function App() {
  const currentBookId = useLibrary((s) => s.currentBookId);
  const [seenLanding, setSeenLanding] = useState(hasSeenLanding);

  const enter = () => {
    try {
      localStorage.setItem(SEEN_LANDING_KEY, '1');
    } catch {
      /* storage unavailable — the landing will show again next visit. */
    }
    setSeenLanding(true);
  };

  if (currentBookId) return <Reader bookId={currentBookId} />;
  if (!seenLanding) return <Landing onEnter={enter} />;
  return <Shelf />;
}
