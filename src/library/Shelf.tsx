import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book } from '../types';
import { addBookFromFile, listBooks, removeBook } from '../db/library';
import { useLibrary } from '../store/library';
import { useTheme } from '../store/theme';
import samplePdf from '../assets/sample.pdf?url';

// Your own bookshelf, fully local (SPEC §7). Drag a PDF in or pick one; it is
// hashed, stored in IndexedDB, and opens instantly and offline. No accounts,
// nothing leaves the device.
export default function Shelf() {
  const openBook = useLibrary((s) => s.openBook);
  const { theme, toggle: toggleTheme } = useTheme();

  const [books, setBooks] = useState<Book[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    listBooks()
      .then(setBooks)
      .catch((e) => setError(`Couldn't read your library: ${String(e)}`));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const ingest = useCallback(
    async (files: FileList | File[]) => {
      const pdfs = Array.from(files).filter(
        (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name),
      );
      if (!pdfs.length) {
        setError('That doesn’t look like a PDF. Drop or pick a .pdf file.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        for (const f of pdfs) await addBookFromFile(f);
        refresh();
      } catch (e) {
        setError(`Couldn’t add that file: ${String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    ingest(e.dataTransfer.files);
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) ingest(e.target.files);
    e.target.value = ''; // allow re-picking the same file
  };

  // Friendly empty state: shelve the bundled sample with one click.
  const addSample = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const bytes = await (await fetch(samplePdf)).blob();
      await addBookFromFile(new File([bytes], 'Sample.pdf', { type: 'application/pdf' }));
      refresh();
    } catch (e) {
      setError(`Couldn’t load the sample: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const onRemove = async (id: string) => {
    try {
      await removeBook(id);
      refresh();
    } catch (e) {
      setError(`Couldn’t remove that book: ${String(e)}`);
    }
  };

  return (
    <div className="flex h-full flex-col bg-neutral-100 text-neutral-900 dark:bg-stone-900 dark:text-stone-100">
      <header className="flex items-center justify-between border-b border-black/10 px-4 py-2 text-sm dark:border-white/10">
        <span className="font-semibold">Reading Stage</span>
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
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-6">
        <h1 className="mb-1 text-lg font-semibold">Your library</h1>
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
          Books live on this device only. Add a PDF to start reading.
        </p>

        {/* Ingest zone: drag-and-drop or click to pick. */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-8 text-center text-sm transition-colors ${
            dragging
              ? 'border-neutral-500 bg-black/5 dark:border-neutral-300 dark:bg-white/5'
              : 'border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5'
          }`}
        >
          <span className="font-medium">
            {busy ? 'Adding…' : 'Drop a PDF here, or click to choose one'}
          </span>
          <span className="text-neutral-500 dark:text-neutral-400">
            Stored locally · nothing is uploaded
          </span>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={onPick}
            className="hidden"
          />
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {books.length === 0 ? (
          <div className="mt-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
            <p>Your shelf is empty.</p>
            <button
              type="button"
              onClick={addSample}
              disabled={busy}
              className="mt-2 rounded px-3 py-1.5 ring-1 ring-black/10 hover:bg-black/5 disabled:opacity-40 dark:ring-white/10 dark:hover:bg-white/5"
            >
              Add the sample book
            </button>
          </div>
        ) : (
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {books.map((book) => (
              <li
                key={book.id}
                className="group relative flex flex-col overflow-hidden rounded-lg ring-1 ring-black/10 dark:ring-white/10"
              >
                <button
                  type="button"
                  onClick={() => openBook(book.id)}
                  className="flex flex-1 flex-col items-start gap-2 p-3 text-left hover:bg-black/5 dark:hover:bg-white/5"
                >
                  {/* Spine/cover placeholder — a cover-render is a later ticket. */}
                  <div className="flex aspect-[3/4] w-full items-end rounded bg-gradient-to-br from-neutral-200 to-neutral-300 p-2 dark:from-neutral-700 dark:to-neutral-800">
                    <span className="line-clamp-3 text-xs font-medium text-neutral-700 dark:text-neutral-200">
                      {book.title}
                    </span>
                  </div>
                  <span className="line-clamp-2 w-full text-sm font-medium" title={book.title}>
                    {book.title}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(book.id)}
                  aria-label={`Remove ${book.title} from library`}
                  title="Remove from library"
                  className="absolute right-1.5 top-1.5 rounded bg-white/80 px-1.5 py-0.5 text-xs opacity-0 ring-1 ring-black/10 transition-opacity hover:bg-white focus:opacity-100 group-hover:opacity-100 dark:bg-neutral-900/80 dark:ring-white/10 dark:hover:bg-neutral-900"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
