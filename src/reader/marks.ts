import type { Annotation } from '../types';

// The highlight palette (SPEC §6.3: multiple colours = multiple meanings). A
// small, distinct set — the solid colour is stored on the annotation; marks are
// painted translucent so the glyphs on the canvas beneath stay readable in both
// light and night mode.
export const HIGHLIGHT_COLORS = [
  { name: 'Yellow', value: '#facc15' },
  { name: 'Green', value: '#4ade80' },
  { name: 'Blue', value: '#60a5fa' },
  { name: 'Pink', value: '#f472b6' },
  { name: 'Orange', value: '#fb923c' },
] as const;

// Default ink for underline / strikethrough (drawn as a solid line, not a wash).
export const UNDERLINE_COLOR = '#2563eb';
export const STRIKE_COLOR = '#dc2626';
// A standalone margin note (issue #10) marks its run with a subtle dotted line
// — enough to show what the note refers to without competing with highlights.
export const NOTE_COLOR = '#a855f7';

// The ink a mark is drawn in — its own colour, or the type's default when it
// carries none (underline / strike / standalone note). Also what the Notebook
// tags an entry with, what the colour filter matches on, and the swatch the
// detail view shows (issues #13, #14).
export function inkOf(a: Annotation): string {
  if (a.color) return a.color;
  if (a.type === 'underline') return UNDERLINE_COLOR;
  if (a.type === 'strike') return STRIKE_COLOR;
  if (a.type === 'note') return NOTE_COLOR;
  return HIGHLIGHT_COLORS[0].value;
}

// The human name for a highlight colour, or the raw value when it's off-palette
// (an underline/strike/note default), or an em dash when there's no colour.
export function colorName(value?: string): string {
  if (!value) return '—';
  return HIGHLIGHT_COLORS.find((c) => c.value === value)?.name ?? value;
}

// A single line-rect of a mark, positioned relative to the page wrapper.
export type MarkRect = { left: number; top: number; width: number; height: number };

// Collapse a range's raw client rects into one rect per visual line.
//
// `Range.getClientRects()` over the pdf.js text layer returns a rect PER text
// item the range crosses, and a styled line (italic runs, a coloured link,
// mixed font sizes) yields several overlapping bands for the same line — e.g. a
// full-width box at H=24 and a near-identical one 2px lower at H=21. Painting
// each as its own translucent div double-stacks the wash (0.4 over 0.4 ≈ 0.64),
// so styled lines read darker than clean ones. Unioning every rect that shares a
// line into a single box paints each line exactly once — a uniform highlight,
// fewer DOM nodes, and cleaner hit-testing. Zero-area rects (the synthetic
// left-edge line-boundary boxes the browser emits) are dropped by the caller's
// width/height filter before this runs.
export function coalesceLineRects(rects: MarkRect[]): MarkRect[] {
  if (rects.length <= 1) return rects.map((r) => ({ ...r }));
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: MarkRect[] = [];
  for (const r of sorted) {
    const line = lines[lines.length - 1];
    // Same visual line when this rect vertically overlaps the current line band.
    if (line && r.top < line.top + line.height && r.top + r.height > line.top) {
      const left = Math.min(line.left, r.left);
      const top = Math.min(line.top, r.top);
      const right = Math.max(line.left + line.width, r.left + r.width);
      const bottom = Math.max(line.top + line.height, r.top + r.height);
      line.left = left;
      line.top = top;
      line.width = right - left;
      line.height = bottom - top;
    } else {
      lines.push({ ...r });
    }
  }
  return lines;
}

// The CSS for one rect of a mark, by type. Highlights wash the whole rect;
// underline/strike are thin lines pinned to the bottom / middle of the rect.
export function markRectStyle(
  type: Annotation['type'],
  color: string | undefined,
  r: MarkRect,
): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    left: r.left,
    top: r.top,
    width: r.width,
  };
  if (type === 'highlight') {
    return { ...base, height: r.height, background: color, opacity: 0.4, borderRadius: 2 };
  }
  if (type === 'underline') {
    return {
      ...base,
      top: r.top + r.height - 2,
      height: 2,
      background: color ?? UNDERLINE_COLOR,
    };
  }
  if (type === 'note') {
    // A dotted underline pins the note to its run, distinct from a solid underline.
    return {
      ...base,
      top: r.top + r.height - 2,
      height: 0,
      borderTop: `2px dotted ${color ?? NOTE_COLOR}`,
    };
  }
  // strike
  return {
    ...base,
    top: r.top + r.height / 2 - 1,
    height: 2,
    background: color ?? STRIKE_COLOR,
  };
}
