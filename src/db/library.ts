import { db } from './db';
import type { Book } from '../types';
import { loadDocument, type PdfDocument } from '../reader/pdf';

// Data-access helpers for the local bookshelf. Everything lives in IndexedDB
// via Dexie — no network, works offline (SPEC §7). Books are keyed by a
// content hash of their bytes so annotations always re-bind to the right book
// and re-adding the same file never duplicates it.

/** SHA-256 hex digest of the PDF bytes → the stable book id. */
export async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// How many leading pages to sample when detecting a text layer. Born-digital
// books routinely open with image-only cover / title / copyright pages that
// carry no text, so checking page 1 alone misclassifies them as scanned (e.g.
// DDIA — text starts on page 3). Sampling a run of early pages catches the real
// text layer while staying cheap.
const TEXT_SAMPLE_PAGES = 10;

// Does the document carry an extractable text layer? Samples the first few pages
// and returns true on the first that has real text — so an image cover in front
// of a selectable book doesn't get mistaken for a scanned book (SPEC §8).
export async function docHasTextLayer(doc: PdfDocument): Promise<boolean> {
  const n = Math.min(doc.numPages, TEXT_SAMPLE_PAGES);
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    const text = await page.getTextContent();
    if (text.items.some((it) => 'str' in it && it.str.trim().length > 0)) return true;
  }
  return false;
}

async function detectTextLayer(bytes: ArrayBuffer): Promise<boolean> {
  try {
    const doc = await loadDocument(bytes);
    const has = await docHasTextLayer(doc);
    await doc.destroy();
    return has;
  } catch {
    // Unreadable pages shouldn't block ingest; assume no text layer.
    return false;
  }
}

/**
 * Re-check a book's text-layer flag against an already-open document and persist
 * a correction. Only heals the harmful direction (a book wrongly stored as
 * scanned that in fact has text — e.g. one ingested before multi-page detection,
 * or with a long image cover), so selection isn't blocked on a born-digital
 * book. Returns the corrected value. Does not destroy the shared `doc`.
 */
export async function reconcileTextLayer(
  id: string,
  doc: PdfDocument,
  stored: boolean,
): Promise<boolean> {
  if (stored) return true; // already known to have text — nothing to fix
  const has = await docHasTextLayer(doc);
  if (has) await db.books.update(id, { hasTextLayer: true });
  return has;
}

/**
 * Ingest a picked/dropped file into the library. Returns the book id — the
 * existing one if these exact bytes are already shelved (dedupe by hash).
 */
export async function addBookFromFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const id = await hashBytes(bytes);

  const existing = await db.books.get(id);
  if (existing) return id; // same bytes → same book, no duplicate

  const title = file.name.replace(/\.pdf$/i, '').trim() || 'Untitled';
  const book: Book = {
    id,
    title,
    bytes: new Blob([bytes], { type: 'application/pdf' }),
    addedAt: Date.now(),
    lastPage: 1,
    hasTextLayer: await detectTextLayer(bytes),
  };
  await db.books.add(book);
  return id;
}

/** All shelved books, most recently added first. */
export async function listBooks(): Promise<Book[]> {
  return db.books.orderBy('addedAt').reverse().toArray();
}

/** One book (bytes included), or undefined if it was removed. */
export async function getBook(id: string): Promise<Book | undefined> {
  return db.books.get(id);
}

/**
 * Persist the reading position for auto-resume (issue #07): the current page and
 * the in-page band offset, keyed by book id. A no-op if the book was removed.
 */
export async function saveBookPosition(
  id: string,
  lastPage: number,
  lastPosition: number,
): Promise<void> {
  await db.books.update(id, { lastPage, lastPosition });
}

/** Remove a book and its bytes, reclaiming storage. Takes its sidecar with it. */
export async function removeBook(id: string): Promise<void> {
  await db.books.delete(id);
  // Annotations are empty in v1, but keep the sidecar tidy for later milestones.
  await db.annotations.where('bookId').equals(id).delete();
}
