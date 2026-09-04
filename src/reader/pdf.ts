import * as pdfjsLib from 'pdfjs-dist';
// Vite bundles the ESM worker and gives us a URL to hand to pdf.js.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDocument = pdfjsLib.PDFDocumentProxy;
export type PdfPage = pdfjsLib.PDFPageProxy;

/** Load a PDF document from a URL or raw bytes. */
export async function loadDocument(
  src: string | ArrayBuffer | Uint8Array,
): Promise<PdfDocument> {
  const params =
    typeof src === 'string' ? { url: src } : { data: src };
  return pdfjsLib.getDocument(params).promise;
}
