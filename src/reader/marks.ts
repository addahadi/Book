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

// A single line-rect of a mark, positioned relative to the page wrapper.
export type MarkRect = { left: number; top: number; width: number; height: number };

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
  // strike
  return {
    ...base,
    top: r.top + r.height / 2 - 1,
    height: 2,
    background: color ?? STRIKE_COLOR,
  };
}
