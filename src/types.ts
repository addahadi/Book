// Domain model for Reading Stage. See SPEC.md §8.
// The PDF file is never rewritten; annotations live in a sidecar keyed by bookId.

export type Book = {
  id: string; // content hash of the PDF bytes
  title: string;
  bytes: Blob; // stored in IndexedDB
  addedAt: number;
  lastPage: number; // for auto-resume
  lastPosition?: number;
  hasTextLayer: boolean;
};

export type AnnotationType =
  | 'highlight'
  | 'underline'
  | 'strike'
  | 'note'
  | 'bookmark'
  | 'region';

// Text range for born-digital PDFs.
export type TextAnchor = {
  kind: 'text';
  // Character offsets within the page's concatenated text layer.
  startOffset: number;
  endOffset: number;
  // Quote fallback for re-binding if offsets drift.
  quote?: string;
};

// Rectangle over the page image for scanned PDFs (normalized 0..1 to page box).
export type RegionRect = {
  kind: 'region';
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Annotation = {
  id: string; // stable, unique
  bookId: string;
  type: AnnotationType;
  page: number;
  anchor: TextAnchor | RegionRect;
  color?: string;
  note?: string; // margin note / reflection body
  label?: string; // for bookmarks
  createdAt: number;
  tags: string[]; // reserved — empty in v1
  links: string[]; // reserved — empty in v1
};
