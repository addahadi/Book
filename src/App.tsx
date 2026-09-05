import Reader from './reader/Reader';
import Shelf from './library/Shelf';
import { useLibrary } from './store/library';

// Two states: the shelf (no book open) or the reader (a book open). The library
// store remembers which book was open across reloads.
export default function App() {
  const currentBookId = useLibrary((s) => s.currentBookId);
  return currentBookId ? <Reader bookId={currentBookId} /> : <Shelf />;
}
