import { db } from './db';
import type { Book } from '../types';
import { loadDocument } from '../reader/pdf';

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

// Does page 1 carry extractable text? Distinguishes born-digital PDFs from
// scanned ones so annotations can later pick the right anchor kind (SPEC §8).
async function detectTextLayer(bytes: ArrayBuffer): Promise<boolean> {
  try {
    const doc = await loadDocument(bytes);
    const page = await doc.getPage(1);
    const text = await page.getTextContent();
    const has = text.items.some((it) => 'str' in it && it.str.trim().length > 0);
    await doc.destroy();
    return has;
  } catch {
    // Unreadable page 1 shouldn't block ingest; assume no text layer.
    return false;
  }
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

/** Remove a book and its bytes, reclaiming storage. Takes its sidecar with it. */
export async function removeBook(id: string): Promise<void> {
  await db.books.delete(id);
  // Annotations are empty in v1, but keep the sidecar tidy for later milestones.
  await db.annotations.where('bookId').equals(id).delete();
}
