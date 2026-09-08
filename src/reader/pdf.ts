import * as pdfjsLib from 'pdfjs-dist';
// Vite bundles the ESM worker and gives us a URL to hand to pdf.js.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDocument = pdfjsLib.PDFDocumentProxy;
export type PdfPage = pdfjsLib.PDFPageProxy;

// The selectable text layer (issue #08). Re-exported here so components consume
// pdf.js only through this module (SPEC §7) — never import pdfjs-dist directly.
export const TextLayer = pdfjsLib.TextLayer;
export type TextLayerInstance = InstanceType<typeof pdfjsLib.TextLayer>;

// A single entry in the PDF's embedded outline / bookmarks (issue #15), with its
// destination already resolved to a 1-based page number. `page` is null when the
// entry has no usable destination (an external URL, an action we don't follow, or
// a dangling reference) — such an entry still shows, it just can't be navigated.
export type OutlineNode = {
  title: string;
  page: number | null;
  children: OutlineNode[];
};

// Resolve an outline entry's destination to a 1-based page number. A dest is
// either an explicit array ([pageRef, ...view]) or a named string that indexes
// into the document's named-destination table; either way the first element is
// the page reference we turn into an index. Returns null for anything we can't
// resolve to a page (no dest, a URL/action entry, or a stale reference).
async function destToPage(
  doc: PdfDocument,
  dest: string | unknown[] | null,
): Promise<number | null> {
  if (!dest) return null;
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const ref = explicit[0];
    if (!ref || typeof ref !== 'object') return null;
    const index = await doc.getPageIndex(ref as Parameters<PdfDocument['getPageIndex']>[0]);
    return index + 1;
  } catch {
    return null;
  }
}

/**
 * Read the PDF's embedded outline (the "bookmarks" pane a viewer shows) as a
 * tree, resolving each entry's destination to a page number up front so the
 * sidebar can navigate on a click without further async work. Returns an empty
 * array when the document has no outline — the caller renders a fallback (#17).
 */
export async function loadOutline(doc: PdfDocument): Promise<OutlineNode[]> {
  // pdf.js types getOutline() loosely; treat items structurally.
  type RawItem = { title?: string; dest?: string | unknown[] | null; items?: RawItem[] };
  const raw = (await doc.getOutline()) as RawItem[] | null;
  if (!raw || raw.length === 0) return [];

  const build = async (items: RawItem[]): Promise<OutlineNode[]> => {
    const out: OutlineNode[] = [];
    for (const it of items) {
      const page = await destToPage(doc, it.dest ?? null);
      const children = it.items?.length ? await build(it.items) : [];
      out.push({ title: it.title?.trim() || 'Untitled', page, children });
    }
    return out;
  };
  return build(raw);
}

/** Load a PDF document from a URL or raw bytes. */
export async function loadDocument(
  src: string | ArrayBuffer | Uint8Array,
): Promise<PdfDocument> {
  if (typeof src === 'string') return pdfjsLib.getDocument({ url: src }).promise;
  // pdf.js transfers a passed buffer to its worker, detaching it — a second
  // load of the same bytes (StrictMode remount, reopening a book) would then
  // fail. Hand it a fresh copy each time so the caller keeps its bytes usable.
  const data = src instanceof Uint8Array ? src.slice() : new Uint8Array(src.slice(0));
  return pdfjsLib.getDocument({ data }).promise;
}
