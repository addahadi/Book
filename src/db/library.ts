import { db } from './db';
import type { Book } from '../types';
import { loadDocument, type PdfDocument } from '../reader/pdf';

// Data-access helpers for the local bookshelf. Everything lives in IndexedDB
// via Dexie — no network, works offline (SPEC §7). Books are keyed by a
// content hash of their bytes so annotations always re-bind to the right book
// and re-adding the same file never duplicates it.

/** SHA-256 hex digest of the PDF bytes → the stable book id. */
export async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  // Web Crypto is only exposed in a secure context (HTTPS or localhost). On a
  // phone reaching a plain-http LAN dev server, `crypto.subtle` is undefined, so
  // fall back to a pure-JS SHA-256. Both paths produce the identical digest, so a
  // book added on any device dedupes and re-binds against the same content hash.
  const digest = crypto.subtle
    ? new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    : sha256(new Uint8Array(bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Pure-JS SHA-256 (FIPS 180-4), used only when Web Crypto is unavailable.
// Operates on a byte array and returns the 32-byte digest.
function sha256(msg: Uint8Array): Uint8Array {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  // Pre-processing: append 0x80, pad with zeros, then the 64-bit bit-length.
  const bitLen = msg.length * 8;
  const withOne = msg.length + 1;
  const total = withOne + ((56 - (withOne % 64) + 64) % 64) + 8;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[msg.length] = 0x80;
  // Bit length as a big-endian 64-bit integer (top 32 bits fit our sizes at 0).
  const view = new DataView(buf.buffer);
  view.setUint32(total - 4, bitLen >>> 0, false);
  view.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let i = 0; i < total; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((hh, i) =>
    outView.setUint32(i * 4, hh >>> 0, false),
  );
  return out;
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
