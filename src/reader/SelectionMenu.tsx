import { HIGHLIGHT_COLORS } from './marks';

// A small floating menu pinned to a selection / mark rect. Two modes: the
// create toolbar (colour swatches + underline / strike) for a fresh selection,
// or a remove button for an existing mark (issue #09). Rendered fixed-position
// in client coordinates, so it tracks the sliding page automatically.
type CreateProps = {
  rect: DOMRect;
  onHighlight: (color: string) => void;
  onUnderline: () => void;
  onStrike: () => void;
  onNote: () => void;
  onRemove?: never;
};
type RemoveProps = {
  rect: DOMRect;
  onRemove: () => void;
  onNote: () => void;
  onHighlight?: never;
  onUnderline?: never;
  onStrike?: never;
};
type Props = CreateProps | RemoveProps;

// Place the menu centred over the rect, flipping below when there's no room
// above. Clamp horizontally so it never spills off the viewport edge.
function position(rect: DOMRect): React.CSSProperties {
  const flipBelow = rect.top < 64;
  const left = Math.min(Math.max(rect.left + rect.width / 2, 80), window.innerWidth - 80);
  return {
    position: 'fixed',
    left,
    top: flipBelow ? rect.bottom + 8 : rect.top - 8,
    transform: `translate(-50%, ${flipBelow ? '0' : '-100%'})`,
    zIndex: 50,
  };
}

export default function SelectionMenu(props: Props) {
  const menu =
    'flex items-center gap-1 rounded-lg border border-black/10 bg-white p-1 shadow-xl ' +
    'dark:border-white/10 dark:bg-stone-800';
  const btn =
    'rounded px-2 py-1 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10';

  // Keep pointer events from bubbling to the reading surface (which would treat
  // them as a page-turn or a dismiss).
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div style={position(props.rect)} className={menu} onClick={stop} onPointerDown={stop}>
      {props.onRemove ? (
        <>
          <button type="button" onClick={props.onNote} className={btn}>
            ✎ Note
          </button>
          <span className="mx-1 h-5 w-px bg-black/10 dark:bg-white/15" />
          <button
            type="button"
            onClick={props.onRemove}
            className={`${btn} text-red-600 dark:text-red-400`}
          >
            Remove
          </button>
        </>
      ) : (
        <>
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => props.onHighlight(c.value)}
              aria-label={`Highlight ${c.name}`}
              title={`Highlight ${c.name}`}
              className="h-6 w-6 rounded-full ring-1 ring-black/15 dark:ring-white/20"
              style={{ background: c.value }}
            />
          ))}
          <span className="mx-1 h-5 w-px bg-black/10 dark:bg-white/15" />
          <button type="button" onClick={props.onUnderline} className={`${btn} underline`}>
            U
          </button>
          <button type="button" onClick={props.onStrike} className={`${btn} line-through`}>
            S
          </button>
          <button type="button" onClick={props.onNote} className={btn} title="Add a note">
            ✎
          </button>
        </>
      )}
    </div>
  );
}
