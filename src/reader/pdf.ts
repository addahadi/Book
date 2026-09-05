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
