import { useEffect, useRef, useState } from 'react';

// A floating editor for a margin note (issue #10), anchored to the note's flag
// (or the run it's being attached to). It edits a local draft and reports the
// body back to the parent — which owns the sidecar — on Done, or automatically
// when the editor closes (a click away or a page turn), so a note is never lost
// to an accidental dismiss. Delete clears the note (removing a standalone note,
// or stripping the note off a highlight while keeping the mark). The editor is
// target-agnostic: the parent knows whether this is a new or existing note.
type Props = {
  rect: DOMRect;
  initial: string;
  onCommit: (body: string) => void;
  onDelete: () => void;
  onClose: () => void;
};

// The panel is fixed-position in client coords (like SelectionMenu) so it tracks
// the sliding page. Centre it over the anchor and drop below, flipping above when
// there's more room there; clamp horizontally so it never spills off-screen.
function position(rect: DOMRect): React.CSSProperties {
  const width = 260;
  const half = width / 2;
  const left = Math.min(Math.max(rect.left + rect.width / 2, half + 8), window.innerWidth - half - 8);
  const below = window.innerHeight - rect.bottom > rect.top;
  return {
    position: 'fixed',
    left,
    top: below ? rect.bottom + 8 : rect.top - 8,
    transform: `translate(-50%, ${below ? '0' : '-100%'})`,
    width,
    zIndex: 50,
  };
}

export default function NoteEditor({ rect, initial, onCommit, onDelete, onClose }: Props) {
  const [text, setText] = useState(initial);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  // Mirror the latest values so the unmount auto-save reads what's on screen now,
  // not what was captured when the effect first ran.
  const latest = useRef({ text, onCommit });
  latest.current = { text, onCommit };
  // Skips the unmount auto-save when Done/Delete has already handled the note.
  const handled = useRef(false);

  useEffect(() => {
    areaRef.current?.focus();
  }, []);

  // Auto-save on unmount (click-away / page turn) unless a button already ran.
  // Committing an unchanged or empty draft is a no-op in the parent, so this is
  // safe even under StrictMode's mount/unmount double-invoke.
  useEffect(
    () => () => {
      if (!handled.current) latest.current.onCommit(latest.current.text);
    },
    [],
  );

  const save = () => {
    handled.current = true;
    onCommit(text);
    onClose();
  };
  const del = () => {
    handled.current = true;
    onDelete();
    onClose();
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      style={position(rect)}
      onClick={stop}
      onPointerDown={stop}
      onPointerUp={stop}
      className="flex flex-col gap-2 rounded-lg border border-black/10 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-stone-800"
    >
      <textarea
        ref={areaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter or Esc commits and closes; plain Enter keeps typing.
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            save();
          }
        }}
        rows={4}
        placeholder="Write a note…"
        className="w-full resize-none rounded border border-black/10 bg-transparent p-2 text-sm outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/30"
      />
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={del}
          className="rounded px-2 py-1 text-sm font-medium text-red-600 hover:bg-black/5 dark:text-red-400 dark:hover:bg-white/10"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={save}
          className="rounded bg-neutral-900 px-3 py-1 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Done
        </button>
      </div>
    </div>
  );
}
