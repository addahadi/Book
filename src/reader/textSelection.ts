// Selection smoothing for our stand-alone pdf.js text layer.
//
// We drive pdf.js's low-level `TextLayer` directly (SPEC §7 — full control over
// pagination and the text/annotation layers), so the selection niceties that
// live in pdf.js's *viewer* (`TextLayerBuilder`) don't come for free. The text
// layer is just a field of transparent, absolutely-positioned glyph boxes; with
// nothing between them, the browser's native selection only "grabs" when the
// cursor is over a box, so dragging across gaps and past line ends feels jumpy.
//
// This ports the missing piece: an `endOfContent` sentinel that a document-level
// `selectionchange` listener repositions right next to the selection anchor and
// stretches to the layer's full size, giving the browser a continuous backdrop
// to extend the selection over. That backdrop is the difference between the
// jumpy behaviour above and the smooth drag you get in Chrome's PDF viewer
// (which runs this exact mechanism). Mirrors pdf.js's `TextLayerBuilder`.

// Live text-layer containers → their `endOfContent` sentinel. A Map (not per-
// instance listeners) so a single global `selectionchange` handler serves every
// mounted page, exactly as pdf.js does.
const layers = new Map<HTMLElement, HTMLElement>();
let abort: AbortController | null = null;
// Cached once: Firefox handles this backdrop natively via -moz-user-select, so
// we skip the sentinel repositioning there (still toggle `.selecting`).
let isFirefox: boolean | null = null;

// Park the sentinel back at the bottom of its layer and drop the selecting flag.
function reset(end: HTMLElement, textLayer: HTMLElement) {
  textLayer.append(end);
  end.style.width = '';
  end.style.height = '';
  textLayer.classList.remove('selecting');
}

// Attach the document-level listeners once, on first registration. They live
// until the last text layer unregisters (see `unregisterTextLayer`).
function enableGlobalListeners() {
  if (abort) return;
  abort = new AbortController();
  const { signal } = abort;

  let isPointerDown = false;
  document.addEventListener('pointerdown', () => (isPointerDown = true), { signal });
  document.addEventListener(
    'pointerup',
    () => {
      isPointerDown = false;
      layers.forEach(reset);
    },
    { signal },
  );
  window.addEventListener(
    'blur',
    () => {
      isPointerDown = false;
      layers.forEach(reset);
    },
    { signal },
  );
  document.addEventListener(
    'keyup',
    () => {
      if (!isPointerDown) layers.forEach(reset);
    },
    { signal },
  );

  let prevRange: Range | null = null;
  document.addEventListener(
    'selectionchange',
    () => {
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) {
        layers.forEach(reset);
        return;
      }

      // Flag every layer the selection actually touches; reset the rest.
      const active = new Set<HTMLElement>();
      for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i);
        for (const textLayer of layers.keys()) {
          if (!active.has(textLayer) && range.intersectsNode(textLayer)) active.add(textLayer);
        }
      }
      for (const [textLayer, end] of layers) {
        if (active.has(textLayer)) textLayer.classList.add('selecting');
        else reset(end, textLayer);
      }

      isFirefox ??=
        getComputedStyle(layers.keys().next().value as HTMLElement).getPropertyValue(
          '-moz-user-select',
        ) === 'none';
      if (isFirefox) return;

      // Slot the sentinel in beside the live edge of the selection and stretch
      // it to fill the layer, so the browser keeps extending over a continuous
      // surface instead of snapping between glyph boxes.
      const range = selection.getRangeAt(0);
      const modifyStart =
        prevRange &&
        (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
          range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
      let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
      if (anchor && anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
      const el = anchor as HTMLElement | null;
      const parentTextLayer = el?.parentElement?.closest<HTMLElement>('.textLayer');
      const end = parentTextLayer ? layers.get(parentTextLayer) : undefined;
      if (end && parentTextLayer && el?.parentElement) {
        end.style.width = parentTextLayer.style.width;
        end.style.height = parentTextLayer.style.height;
        el.parentElement.insertBefore(end, modifyStart ? el : el.nextSibling);
      }
      prevRange = range.cloneRange();
    },
    { signal },
  );
}

// Register a text-layer container for selection smoothing, creating (or reusing)
// its `endOfContent` sentinel and appending it after the glyph spans. Idempotent:
// safe to call again after the layer's children are re-rendered (the sentinel is
// re-appended, keeping the same node identity the Map holds).
export function ensureTextLayerRegistered(host: HTMLElement): void {
  let end = layers.get(host);
  if (!end) {
    end = host.querySelector<HTMLElement>(':scope > .endOfContent') ?? undefined;
    if (!end) {
      end = document.createElement('div');
      end.className = 'endOfContent';
    }
    layers.set(host, end);
  }
  if (end.parentElement !== host) host.append(end); // re-append after a re-render
  enableGlobalListeners();
}

// Detach a text layer on unmount; tear down the global listeners once none remain.
export function unregisterTextLayer(host: HTMLElement | null): void {
  if (!host) return;
  layers.get(host)?.remove();
  layers.delete(host);
  if (layers.size === 0) {
    abort?.abort();
    abort = null;
  }
}
