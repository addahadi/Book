import { db } from './db';
import type { Annotation } from '../types';

// Data-access for the annotation sidecar (SPEC §6.3). Marks live in IndexedDB
// keyed by book id — the PDF bytes are never rewritten — so they re-bind to the
// right text when a book is reopened. Everything stays on the device (SPEC §7).

/** Every annotation for a book, oldest first (stable reading-ish order). */
export async function listAnnotations(bookId: string): Promise<Annotation[]> {
  const rows = await db.annotations.where('bookId').equals(bookId).toArray();
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

/** Persist a new mark to the sidecar. */
export async function addAnnotation(annotation: Annotation): Promise<void> {
  await db.annotations.add(annotation);
}

/** Patch fields on an existing mark (e.g. a margin note body — issue #10). */
export async function updateAnnotation(
  id: string,
  changes: Partial<Annotation>,
): Promise<void> {
  await db.annotations.update(id, changes);
}

/** Remove a mark by id. */
export async function removeAnnotation(id: string): Promise<void> {
  await db.annotations.delete(id);
}
