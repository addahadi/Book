import Dexie, { type Table } from 'dexie';
import type { Annotation, Book } from '../types';

// Local-first storage. Book bytes + annotation sidecar live entirely in IndexedDB.
// v1 has no backend; nothing leaves the device.
export class ReadingStageDB extends Dexie {
  books!: Table<Book, string>;
  annotations!: Table<Annotation, string>;

  constructor() {
    super('reading-stage');
    this.version(1).stores({
      books: 'id, addedAt',
      annotations: 'id, bookId, page, type, color',
    });
  }
}

export const db = new ReadingStageDB();
