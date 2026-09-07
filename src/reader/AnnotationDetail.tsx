import { useState } from 'react';
import { colorName, inkOf } from './marks';
import { buildCopyText, useCopyFeedback } from './copy';
import { CopyIcon, TYPE_LABEL, TypeIcon } from './NotebookPanel';
import type { Annotation } from '../types';

// The detail view for a single annotation (issue #14): a highlight / note /
// bookmark shown as a first-class object — its excerpt, its (expandable) note
// body, its metadata (book, page, date, colour), and a "Go to source" link back
// into the reader. Reached from a Notebook entry and addressed by the mark's
// stable id. Read-only: notes are edited in place via the page's ✎ flag; this
// view leaves room for the reserved tags/links (SPEC §8) without building them.
type Props = {
  annotation: Annotation;
  /** The book this mark belongs to, for the metadata block. */
  bookTitle: string;
  /** Return to the Notebook list. */
  onBack: () => void;
  /** Jump to the mark's page in the reader. */
  onGoToSource: (page: number) => void;
};

// How long a note can be before it's collapsed behind a "Show more" toggle.
const NOTE_CLAMP = 240;

// The quoted run a mark anchors to, when it has one. Region boxes and page-level
// bookmarks anchor to no text, so they have no excerpt.
function excerptOf(a: Annotation): string | null {
  if (a.anchor?.kind === 'text' && a.anchor.quote) return a.anchor.quote;
  return null;
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-right text-sm">{children}</dd>
    </div>
  );
}

// A reserved slot for a not-yet-built feature (tags / linked notes). Rendered
// disabled so the detail view has room for it without implying it works in v1.
function ReservedSection({ label, hint }: { label: string; hint: string }) {
  return (
    <section className="opacity-60">
      <h3 className="mb-1 text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </h3>
      <p className="rounded border border-dashed border-black/15 px-3 py-2 text-sm text-neutral-500 dark:border-white/15 dark:text-neutral-400">
        {hint}
      </p>
    </section>
  );
}

export default function AnnotationDetail({ annotation, bookTitle, onBack, onGoToSource }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { copiedKey, copy } = useCopyFeedback();
  const copied = copiedKey === annotation.id;

  const ink = inkOf(annotation);
  const excerpt = excerptOf(annotation);
  const note = annotation.note ?? '';
  const longNote = note.length > NOTE_CLAMP;
  const shownNote = longNote && !expanded ? `${note.slice(0, NOTE_CLAMP).trimEnd()}…` : note;

  const created = new Date(annotation.createdAt);
  const dateStr = created.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const timeStr = created.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const isHighlightWash = annotation.type === 'highlight';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Back to the list. */}
      <div className="flex items-center gap-2 border-b border-black/10 px-3 py-2.5 dark:border-white/10">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded px-2 py-1 text-sm text-neutral-600 ring-1 ring-black/10 hover:bg-black/5 dark:text-neutral-300 dark:ring-white/10 dark:hover:bg-white/5"
        >
          ← Notebook
        </button>
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className="flex h-5 w-5 items-center justify-center">
            <TypeIcon type={annotation.type} ink={ink} />
          </span>
          {TYPE_LABEL[annotation.type]}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-auto px-4 py-4">
        {/* Excerpt — the anchored text, or a note on why there's none. */}
        <section>
          <h3 className="mb-1.5 text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Excerpt
          </h3>
          {excerpt ? (
            <blockquote
              className="rounded-r border-l-[3px] py-2 pl-3 pr-2 text-[15px] leading-relaxed"
              style={{
                borderLeftColor: ink,
                background: isHighlightWash ? `${ink}22` : 'transparent',
              }}
            >
              {excerpt}
            </blockquote>
          ) : (
            <p className="text-sm italic text-neutral-500 dark:text-neutral-400">
              {annotation.type === 'region'
                ? 'A region drawn over the page image (no selectable text).'
                : annotation.type === 'bookmark'
                  ? annotation.label || 'A page bookmark.'
                  : 'No anchored text.'}
            </p>
          )}
        </section>

        {/* Note — expandable when long. */}
        <section>
          <h3 className="mb-1.5 text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Note
          </h3>
          {note ? (
            <>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{shownNote}</p>
              {longNote && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-1 text-xs font-medium text-neutral-600 hover:underline dark:text-neutral-300"
                >
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </>
          ) : (
            <p className="text-sm italic text-neutral-500 dark:text-neutral-400">
              No note. Add one from the ✎ flag on the page.
            </p>
          )}
        </section>

        {/* Metadata. */}
        <section>
          <h3 className="mb-1 text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Details
          </h3>
          <dl className="divide-y divide-black/5 dark:divide-white/5">
            <Meta label="Book">
              <span title={bookTitle}>{bookTitle || 'Untitled'}</span>
            </Meta>
            <Meta label="Page">
              <span className="tabular-nums">{annotation.page}</span>
            </Meta>
            <Meta label="Added">
              <span title={`${dateStr} ${timeStr}`}>
                {dateStr}, {timeStr}
              </span>
            </Meta>
            <Meta label="Colour">
              <span className="flex items-center justify-end gap-2">
                <span
                  className="h-3.5 w-3.5 rounded-full ring-1 ring-black/15 dark:ring-white/20"
                  style={{ background: ink }}
                />
                {colorName(annotation.color)}
              </span>
            </Meta>
            <Meta label="Type">{TYPE_LABEL[annotation.type]}</Meta>
            <Meta label="ID">
              <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400" title={annotation.id}>
                {annotation.id.slice(0, 8)}
              </span>
            </Meta>
          </dl>
        </section>

        {/* Reserved for later versions — the model keeps room for these (SPEC §8). */}
        <ReservedSection label="Tags" hint="Tags arrive in a later version." />
        <ReservedSection label="Linked notes" hint="Note-linking arrives in a later version." />
      </div>

      {/* Copy (plain-text excerpt + note + citation) and Go to source. */}
      <div className="flex items-center gap-2 border-t border-black/10 p-3 dark:border-white/10">
        <button
          type="button"
          onClick={() => copy(annotation.id, buildCopyText(annotation, bookTitle))}
          aria-label="Copy this mark to the clipboard"
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-black/15 hover:bg-black/5 dark:ring-white/15 dark:hover:bg-white/5"
        >
          <CopyIcon />
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={() => onGoToSource(annotation.page)}
          className="flex-1 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
        >
          Go to source · page {annotation.page} →
        </button>
      </div>
    </div>
  );
}
